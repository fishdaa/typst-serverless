/**
 * Core compile logic unit tests.
 * Tests: compile .typ -> PDF, error handling, output path.
 * Run via `npm test` (inside Docker) — typst is available in the container.
 * With TYPST_TEST_KEEP_OUTPUT=1, outputs are written to test-output/core-compile/ for inspection.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { join } from "node:path";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { getOutputPathAndDir, shouldKeepOutput } from "../test-output-helper.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("core/compile", () => {
    it("compiles minimal.typ to PDF", async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "minimal.pdf");
        try {
            const input = join(FIXTURES, "minimal.typ");
            await compile(input, output);
            assert(existsSync(output), "Output PDF should exist");
            const buf = readFileSync(output);
            assert(buf.length > 0, "Output should be non-empty");
            assert(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44, "Output should be valid PDF header %PD");
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles simple-doc.typ to PDF", async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "simple-doc.pdf");
        try {
            const input = join(FIXTURES, "simple-doc.typ");
            await compile(input, output);
            assert(existsSync(output), "Output PDF should exist");
            const buf = readFileSync(output);
            assert(buf.length > 100, "Output should be meaningful size");
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("throws on invalid input path", async () => {
        const { output, outDir } = getOutputPathAndDir("core-compile", "nonexistent.pdf");
        try {
            await assert.rejects(
                () => compile(join(FIXTURES, "nonexistent.typ"), output),
                /ENOENT|not found|No such file/i
            );
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("throws on invalid Typst syntax", async () => {
        const { output, outDir } = getOutputPathAndDir("core-compile", "invalid.pdf");
        try {
            const input = join(FIXTURES, "invalid-syntax.typ");
            await assert.rejects(
                () => compile(input, output),
                /compile|error|failed|invalid/i
            );
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });
});
