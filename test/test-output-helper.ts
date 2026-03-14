/**
 * Helper for tests that produce output files (PDF, SVG, PNG).
 * When TYPST_TEST_KEEP_OUTPUT=1, outputs are written to test-output/ for manual inspection.
 * Run: TYPST_TEST_KEEP_OUTPUT=1 npm test
 * Outputs: test-output/core-compile/, test-output/output-variants/, test-output/batch/, etc.
 */
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const KEEP_OUTPUT = process.env.TYPST_TEST_KEEP_OUTPUT === "1" || process.env.TYPST_TEST_KEEP_OUTPUT === "true";
const OUTPUT_DIR = join(process.cwd(), "test-output");

export function shouldKeepOutput(): boolean {
    return KEEP_OUTPUT;
}

/** Returns path and dir for cleanup. When keeping, dir is parent of path; when not, dir is temp. */
export function getOutputPathAndDir(suite: string, filename: string): { output: string; outDir: string } {
    if (KEEP_OUTPUT) {
        const outDir = join(OUTPUT_DIR, suite);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        return { output: join(outDir, filename), outDir };
    }
    const outDir = mkdtempSync(join(tmpdir(), "typst-test-"));
    return { output: join(outDir, filename), outDir };
}

export function getOutputBase(): string {
    return OUTPUT_DIR;
}
