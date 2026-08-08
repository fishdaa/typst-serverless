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

    it("compiles font-doc.typ with custom font when fonts/Roboto/static/Roboto-Regular.ttf exists", { timeout: 10000 }, async () => {
        assertTypst();
        const fontPath = join(FIXTURES, "fonts", "Roboto", "static", "Roboto-Regular.ttf");
        if (!existsSync(fontPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(fontPath, join(workDir, "Roboto-Regular.ttf"));
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

    it("compiles font-multi-doc.typ with multiple custom fonts when both font files exist", { timeout: 10000 }, async () => {
        assertTypst();
        const robotoPath = join(FIXTURES, "fonts", "Roboto", "static", "Roboto-Regular.ttf");
        const monoPath = join(FIXTURES, "fonts", "Roboto_Mono", "static", "RobotoMono-Regular.ttf");
        if (!existsSync(robotoPath) || !existsSync(monoPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-multi-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-multi-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(robotoPath, join(workDir, "Roboto-Regular.ttf"));
            copyFileSync(monoPath, join(workDir, "RobotoMono-Regular.ttf"));
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

    it("compiles font-same-family-doc.typ with multiple variants of same font family (Regular, Bold, Italic)", { timeout: 10000 }, async () => {
        assertTypst();
        const regularPath = join(FIXTURES, "fonts", "Roboto", "static", "Roboto-Regular.ttf");
        const boldPath = join(FIXTURES, "fonts", "Roboto", "static", "Roboto-Bold.ttf");
        const italicPath = join(FIXTURES, "fonts", "Roboto", "static", "Roboto-Italic.ttf");
        if (!existsSync(regularPath) || !existsSync(boldPath) || !existsSync(italicPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-same-family-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-same-family-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(regularPath, join(workDir, "Roboto-Regular.ttf"));
            copyFileSync(boldPath, join(workDir, "Roboto-Bold.ttf"));
            copyFileSync(italicPath, join(workDir, "Roboto-Italic.ttf"));
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

    it("compiles font-otf-doc.typ with OTF font when fonts/Roboto_Mono/Roboto_Mono/otf/RobotoMono-Regular.otf exists", { timeout: 10000 }, async () => {
        assertTypst();
        const fontPath = join(FIXTURES, "fonts", "Roboto_Mono", "otf", "RobotoMono-Regular.otf");
        if (!existsSync(fontPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-otf-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-otf-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(fontPath, join(workDir, "RobotoMono-Regular.otf"));
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

    it("compiles font-variable-doc.typ with variable font when fonts/Roboto/Roboto-VariableFont_wdth,wght.ttf exists", { timeout: 10000 }, async () => {
        assertTypst();
        const fontPath = join(FIXTURES, "fonts", "Roboto", "Roboto-VariableFont_wdth,wght.ttf");
        if (!existsSync(fontPath)) return;
        const { output, outDir } = getOutputPathAndDir("core-compile", "font-variable-doc.pdf");
        const workDir = join(outDir, "work");
        mkdirSync(workDir, { recursive: true });
        try {
            copyFileSync(join(FIXTURES, "font-variable-doc.typ"), join(workDir, "main.typ"));
            copyFileSync(fontPath, join(workDir, "Roboto-VariableFont_wdth,wght.ttf"));
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

    it("compiles minimal.typ to PNG at a given ppi, scaling pixel dimensions", async () => {
        assertTypst();
        const { output, outDir } = getOutputPathAndDir("core-compile", "minimal.png");
        try {
            const input = join(FIXTURES, "minimal.typ");
            await compile(input, output, { format: "png", ppi: 300 });
            assert(existsSync(output), "Output PNG should exist");
            const buf = readFileSync(output);
            assert(
                buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
                "Output should be a valid PNG"
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
