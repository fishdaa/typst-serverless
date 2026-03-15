/**
 * Core compile logic unit tests.
 * Tests: compile .typ -> PDF, error handling, output path.
 * Run via `npm test` (inside Docker) — typst is available in the container.
 * With TYPST_TEST_KEEP_OUTPUT=1, outputs are written to test-output/<timestamp>/core-compile/ for inspection.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { getOutputPathAndDir, shouldKeepOutput, assertTypst } from "../test-output-helper.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

describe("core/compile", () => {
    it("compiles minimal.typ to PDF", async () => {
        assertTypst();
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
        assertTypst();
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

    it("compiles doc-with-assets.typ with image and data.json", async () => {
        assertTypst();
        const { output, outDir } = getOutputPathAndDir("core-compile", "doc-with-assets.pdf");
        try {
            const input = join(FIXTURES, "doc-with-assets.typ");
            // doc-with-assets.typ requires logo.png + data.json in same dir (--root = dirname(input))
            await compile(input, output);
            assert(existsSync(output), "Output PDF should exist");
            const buf = readFileSync(output);
            assert(buf.length > 200, "Output should be meaningful size");
            assert(buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles doc-with-images.typ with fish.jpg when images exist", async () => {
        assertTypst();
        const fishJpg = join(FIXTURES, "images", "fish.jpg");
        if (!existsSync(fishJpg)) return;
        const workDir = join(tmpdir(), `typst-samples-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const output = join(workDir, "out.pdf");
        mkdirSync(workDir, { recursive: true });
        try {
            const { writeFileSync, copyFileSync } = await import("node:fs");
            writeFileSync(mainPath, readFileSync(join(FIXTURES, "doc-with-images.typ"), "utf-8"));
            copyFileSync(join(FIXTURES, "logo.png"), join(workDir, "logo.png"));
            copyFileSync(fishJpg, join(workDir, "fish.jpg"));
            writeFileSync(join(workDir, "data.json"), readFileSync(join(FIXTURES, "data.json"), "utf-8"));
            await compile(mainPath, output);
            assert(existsSync(output));
            const buf = readFileSync(output);
            assert(buf.length > 300 && buf[0] === 0x25 && buf[1] === 0x50);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    it("compiles font-doc.typ with custom font when fonts/test.ttf exists (e.g. Roboto)", { timeout: 10000 }, async () => {
        assertTypst();
        const fontPath = join(FIXTURES, "fonts", "test.ttf");
        if (!existsSync(fontPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(fontPath, join(workDir, "test.ttf"));
            const input = join(workDir, "main.typ");
            await compile(input, output);
            assert(existsSync(output), "Output PDF should exist");
            const buf = readFileSync(output);
            assert(buf.length > 100);
            assert(buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
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
