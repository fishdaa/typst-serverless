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
