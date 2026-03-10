/**
 * Abstract state interface for job/document tracking.
 * In-memory for local; file-based for container; DynamoDB for Lambda (Phase 2).
 */

/** @typedef {{ status: string; outputPath?: string; [key: string]: unknown }} JobState */

/**
 * @typedef {object} StateStore
 * @property {(id: string, data: JobState) => Promise<void>} set
 * @property {(id: string) => Promise<JobState | undefined>} get
 * @property {(id: string, updates: Partial<JobState>) => Promise<void>} update
 */

/** @returns {StateStore} */
export function createInMemoryState() {
  const store = new Map();
  return {
    async set(id, data) {
      store.set(id, { ...data });
    },
    async get(id) {
      const v = store.get(id);
      return v ? { ...v } : undefined;
    },
    async update(id, updates) {
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
 * @param {string} baseDir - Directory for state files
 * @returns {StateStore}
 */
export function createFileState(baseDir) {

  const stateFile = join(baseDir, "state.json");

  async function readAll() {
    try {
      const raw = await readFile(stateFile, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async function writeAll(data) {
    await mkdir(baseDir, { recursive: true });
    await writeFile(stateFile, JSON.stringify(data, null, 2), "utf-8");
  }

  return {
    async set(id, data) {
      const all = await readAll();
      all[id] = { ...data };
      await writeAll(all);
    },
    async get(id) {
      const all = await readAll();
      return all[id] ? { ...all[id] } : undefined;
    },
    async update(id, updates) {
      const all = await readAll();
      const v = all[id];
      if (!v) return;
      all[id] = { ...v, ...updates };
      await writeAll(all);
    },
  };
}

/**
 * DynamoDB state store for Lambda (Phase 2).
 * Table: document_id (PK), status, s3_key?, error?, createdAt, updatedAt
 * @param {object} opts - { tableName, documentClient }
 * @returns {StateStore}
 */
export function createDynamoDBState(opts = {}) {
  const tableName = opts.tableName || process.env.TYPST_STATE_TABLE || "typst-documents";
  const docClient = opts.documentClient;

  if (!docClient) {
    throw new Error("DynamoDB DocumentClient required for createDynamoDBState");
  }

  return {
    async set(id, data) {
      const now = Date.now();
      await docClient.put({
        TableName: tableName,
        Item: {
          document_id: id,
          status: data.status ?? "pending",
          ...(data.s3_key && { s3_key: data.s3_key }),
          ...(data.error && { error: data.error }),
          createdAt: data.createdAt ?? now,
          updatedAt: now,
        },
      });
    },
    async get(id) {
      const { Item } = await docClient.get({
        TableName: tableName,
        Key: { document_id: id },
      });
      if (!Item) return undefined;
      return {
        status: Item.status,
        s3_key: Item.s3_key,
        error: Item.error,
        createdAt: Item.createdAt,
        updatedAt: Item.updatedAt,
      };
    },
    async update(id, updates) {
      const now = Date.now();
      const expr = [];
      const names = {};
      const values = { ":updated": now };

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

      await docClient.update({
        TableName: tableName,
        Key: { document_id: id },
        UpdateExpression: "SET " + expr.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      });
    },
  };
}
