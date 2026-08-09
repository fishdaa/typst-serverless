/**
 * Per-step CPU/RAM logging for the Lambda handler, so a CloudWatch log
 * search for a documentId shows what each stage of a compile (resolving
 * input, spawning typst, uploading to S3) cost — not just the single
 * REPORT line Lambda prints at the end.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

function toMB(bytes: number): number {
    return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

export interface StepLogBase {
    documentId: string;
    batchId?: string;
    action: string;
}

/**
 * Emits one JSON log line per step with CPU/RSS deltas since the previous
 * step. Captures Node's own process usage; for the typst subprocess itself
 * (the actual memory risk for large PNGs) see `pollChildRss` below.
 */
export class StepLog {
    private lastTime: number;
    private lastCpu: NodeJS.CpuUsage;

    constructor(private base: StepLogBase) {
        this.lastTime = Date.now();
        this.lastCpu = process.cpuUsage();
    }

    emit(step: string, extra: Record<string, unknown> = {}): void {
        const now = Date.now();
        const cpu = process.cpuUsage(this.lastCpu);
        const mem = process.memoryUsage();
        if (!process.env.VITEST) {
            console.log(JSON.stringify({
                msg: "typst-step",
                step,
                ...this.base,
                sinceLastMs: now - this.lastTime,
                nodeCpuUserMs: Math.round(cpu.user / 1000),
                nodeCpuSysMs: Math.round(cpu.system / 1000),
                nodeRssMB: toMB(mem.rss),
                nodeHeapUsedMB: toMB(mem.heapUsed),
                ...extra,
            }));
        }
        this.lastTime = now;
        this.lastCpu = process.cpuUsage();
    }
}

async function readProcRssKB(pid: number): Promise<number | undefined> {
    try {
        const status = await readFile(`/proc/${pid}/status`, "utf-8");
        const match = status.match(/^VmRSS:\s+(\d+) kB/m);
        return match ? Number(match[1]) : undefined;
    } catch {
        return undefined; // process already exited, or /proc unavailable
    }
}

/**
 * Polls a child process's resident memory while it runs (typst itself, not
 * Node), since that's what actually OOMs on large PNG renders. Returns a
 * `stop()` that gives back the peak RSS observed in MB.
 */
export function pollChildRss(pid: number, intervalMs = 200): { stop(): number } {
    let peakKB = 0;
    const timer = setInterval(() => {
        void readProcRssKB(pid).then((kb) => {
            if (kb !== undefined && kb > peakKB) peakKB = kb;
        });
    }, intervalMs);
    return {
        stop(): number {
            clearInterval(timer);
            return Math.round((peakKB / 1024) * 10) / 10;
        },
    };
}

async function dirSizeBytes(dir: string): Promise<number> {
    let total = 0;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await dirSizeBytes(full);
        } else {
            try {
                total += (await stat(full)).size;
            } catch {
                // file may have been removed concurrently; skip
            }
        }
    }
    return total;
}

/** Recursively sums file sizes under a directory; best-effort, for logging resolved-input size (assets/fonts/data). */
export async function dirSizeMB(dir: string): Promise<number> {
    return toMB(await dirSizeBytes(dir));
}
