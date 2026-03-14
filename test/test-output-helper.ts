/**
 * Helper for tests that produce output files (PDF, SVG, PNG).
 * When TYPST_TEST_KEEP_OUTPUT=1, outputs are written to test-output/<run>/ for manual inspection.
 * Each run uses a timestamp subdir (e.g. test-output/2025-03-14T12-30-45/core-compile/) so runs don't overwrite.
 * Use TYPST_TEST_OUTPUT_RUN=<name> to override the run dir (e.g. test-output/my-run/core-compile/).
 * Run: TYPST_TEST_KEEP_OUTPUT=1 npm test
 */
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const KEEP_OUTPUT = process.env.TYPST_TEST_KEEP_OUTPUT === "1" || process.env.TYPST_TEST_KEEP_OUTPUT === "true";
const OUTPUT_DIR = join(process.cwd(), "test-output");
const RUN_DIR =
    KEEP_OUTPUT &&
    (process.env.TYPST_TEST_OUTPUT_RUN ||
        new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));

export function shouldKeepOutput(): boolean {
    return KEEP_OUTPUT;
}

/** Returns path and dir for cleanup. When keeping, dir is parent of path; when not, dir is temp. */
export function getOutputPathAndDir(suite: string, filename: string): { output: string; outDir: string } {
    if (KEEP_OUTPUT && RUN_DIR) {
        const outDir = join(OUTPUT_DIR, RUN_DIR, suite);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        return { output: join(outDir, filename), outDir };
    }
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    return { output: join(outDir, filename), outDir };
}

export function getOutputBase(): string {
    return OUTPUT_DIR;
}
