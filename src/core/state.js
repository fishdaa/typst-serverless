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
