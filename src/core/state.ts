/**
 * Abstract state interface for job/document tracking.
 * In-memory for local; file-based for container; DynamoDB for Lambda.
 */

export interface JobState {
  status: string;
  outputPath?: string;
  s3_key?: string;
  s3_bucket?: string;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface StateStore {
  set(id: string, data: JobState): Promise<void>;
  get(id: string): Promise<JobState | undefined>;
  update(id: string, updates: Partial<JobState>): Promise<void>;
}

export function createInMemoryState(): StateStore {
    const store = new Map<string, JobState>();
    return {
        async set(id: string, data: JobState) {
            store.set(id, { ...data });
        },
        async get(id: string) {
            const v = store.get(id);
            return v ? { ...v } : undefined;
        },
        async update(id: string, updates: Partial<JobState>) {
            const v = store.get(id);
            if (!v) return;
            store.set(id, { ...v, ...updates });
        },
    };
}

import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

/**
 * File-based state store for container volume.
 */
export function createFileState(baseDir: string): StateStore {
    const stateFile = join(baseDir, "state.json");

    async function readAll(): Promise<Record<string, JobState>> {
        try {
            const raw = await readFile(stateFile, "utf-8");
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    async function writeAll(data: Record<string, JobState>): Promise<void> {
        await mkdir(baseDir, { recursive: true });
        await writeFile(stateFile, JSON.stringify(data, null, 2), "utf-8");
    }

    return {
        async set(id: string, data: JobState) {
            const all = await readAll();
            all[id] = { ...data };
            await writeAll(all);
        },
        async get(id: string) {
            const all = await readAll();
            return all[id] ? { ...all[id] } : undefined;
        },
        async update(id: string, updates: Partial<JobState>) {
            const all = await readAll();
            const v = all[id];
            if (!v) return;
            all[id] = { ...v, ...updates };
            await writeAll(all);
        },
    };
}

import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface DynamoDBStateOptions {
  tableName?: string;
  documentClient?: DynamoDBDocumentClient;
}

/**
 * DynamoDB state store for Lambda.
 */
export function createDynamoDBState(opts: DynamoDBStateOptions = {}): StateStore {
    const tableName = opts.tableName || process.env.TYPST_STATE_TABLE || "typst-documents";
    const docClient = opts.documentClient;

    if (!docClient) {
        throw new Error("DynamoDB DocumentClient required for createDynamoDBState");
    }

    return {
        async set(id: string, data: JobState) {
            const now = Date.now();
            await docClient.send(new PutCommand({
                TableName: tableName,
                Item: {
                    document_id: id,
                    status: data.status ?? "pending",
                    ...(data.s3_key && { s3_key: data.s3_key }),
                    ...(data.error && { error: data.error }),
                    createdAt: data.createdAt ?? now,
                    updatedAt: now,
                },
            }));
        },
        async get(id: string) {
            const { Item } = await docClient.send(new GetCommand({
                TableName: tableName,
                Key: { document_id: id },
            }));
            if (!Item) return undefined;
            return {
                status: Item.status,
                s3_key: Item.s3_key,
                s3_bucket: Item.s3_bucket,
                error: Item.error,
                createdAt: Item.createdAt,
                updatedAt: Item.updatedAt,
            } as JobState;
        },
        async update(id: string, updates: Partial<JobState>) {
            const now = Date.now();
            const expr: string[] = [];
            const names: Record<string, string> = {};
            const values: Record<string, unknown> = { ":updated": now };

            if (updates.status !== undefined) {
                expr.push("#status = :status");
                names["#status"] = "status";
                values[":status"] = updates.status;
            }
            if (updates.s3_key !== undefined) {
                expr.push("#s3_key = :s3_key");
                names["#s3_key"] = "s3_key";
                values[":s3_key"] = updates.s3_key;
            }
            if (updates.error !== undefined) {
                expr.push("#error = :error");
                names["#error"] = "error";
                values[":error"] = updates.error;
            }

            expr.push("#updatedAt = :updated");
            names["#updatedAt"] = "updatedAt";

            await docClient.send(new UpdateCommand({
                TableName: tableName,
                Key: { document_id: id },
                UpdateExpression: "SET " + expr.join(", "),
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
            }));
        },
    };
}
