/**
 * DynamoDB state store for Lambda.
 * Isolated so container (which uses file state) does not load AWS SDK.
 */
import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { JobState, StateStore } from "./state.js";

export interface DynamoDBStateOptions {
    tableName?: string;
    documentClient?: DynamoDBDocumentClient;
}

export function createDynamoDBState(opts: DynamoDBStateOptions = {}): StateStore {
    const tableName = opts.tableName || process.env.TYPST_STATE_TABLE || "typst-documents";
    const docClient = opts.documentClient;

    if (!docClient) {
        throw new Error("DynamoDB DocumentClient required for createDynamoDBState");
    }

    return {
        async set(id: string, data: JobState) {
            const now = Date.now();
            const item: Record<string, unknown> = {
                document_id: id,
                status: data.status ?? "pending",
                createdAt: data.createdAt ?? now,
                updatedAt: now,
            };
            if (data.s3_key) item.s3_key = data.s3_key;
            if (data.s3_bucket) item.s3_bucket = data.s3_bucket;
            if (data.error) item.error = data.error;
            if (data.batch_id) item.batch_id = data.batch_id;
            await docClient.send(
                new PutCommand({
                    TableName: tableName,
                    Item: item,
                })
            );
        },
        async get(id: string) {
            const { Item } = await docClient.send(
                new GetCommand({
                    TableName: tableName,
                    Key: { document_id: id },
                })
            );
            if (!Item) return undefined;
            return {
                status: Item.status,
                s3_key: Item.s3_key,
                s3_bucket: Item.s3_bucket,
                error: Item.error,
                batch_id: Item.batch_id,
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
            if (updates.s3_bucket !== undefined) {
                expr.push("#s3_bucket = :s3_bucket");
                names["#s3_bucket"] = "s3_bucket";
                values[":s3_bucket"] = updates.s3_bucket;
            }
            if (updates.batch_id !== undefined) {
                expr.push("#batch_id = :batch_id");
                names["#batch_id"] = "batch_id";
                values[":batch_id"] = updates.batch_id;
            }
            if (updates.error !== undefined) {
                expr.push("#error = :error");
                names["#error"] = "error";
                values[":error"] = updates.error;
            }

            expr.push("#updatedAt = :updated");
            names["#updatedAt"] = "updatedAt";

            await docClient.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: { document_id: id },
                    UpdateExpression: "SET " + expr.join(", "),
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                })
            );
        },
    };
}
