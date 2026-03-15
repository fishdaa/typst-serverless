/**
 * Data file variations: data (base64/S3) + dataFile for Typst (json, yaml, toml, etc.).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getOutputPathAndDir, shouldKeepOutput, assertTypst } from "../test-output-helper.js";

const __testDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__testDir, "../fixtures");

describe("core data variations", () => {
    it("compiles when data.json exists with minimal JSON", async () => {
        assertTypst();
        const workDir = join(tmpdir(), `typst-data-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("data-variations", "minimal.pdf");
        mkdirSync(workDir, { recursive: true });
        writeFileSync(mainPath, '#set page(width:100pt)\n#let d = json("data.json")\nHello, #d.hello!');
        writeFileSync(join(workDir, "data.json"), '{"hello":"world"}');
        try {
            await compile(mainPath, output, { root: workDir });
            assert(existsSync(output));
            const buf = readFileSync(output);
            assert(buf.length > 0);
            assert(buf[0] === 0x25 && buf[1] === 0x50);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles when data.json has nested JSON", async () => {
        assertTypst();
        const workDir = join(tmpdir(), `typst-data-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("data-variations", "nested.pdf");
        mkdirSync(workDir, { recursive: true });
        writeFileSync(mainPath, '#set page(width:100pt)\n#let d = json("data.json")\n#d.title');
        writeFileSync(join(workDir, "data.json"), '{"title":"Report","meta":{"author":"Test"}}');
        try {
            await compile(mainPath, output, { root: workDir });
            assert(existsSync(output));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles when data.json is empty object", async () => {
        assertTypst();
        const workDir = join(tmpdir(), `typst-data-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("data-variations", "empty.pdf");
        mkdirSync(workDir, { recursive: true });
        writeFileSync(mainPath, '#set page(width:100pt)\n#let d = json("data.json")\nEmpty object works');
        writeFileSync(join(workDir, "data.json"), "{}");
        try {
            await compile(mainPath, output, { root: workDir });
            assert(existsSync(output));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles when data.yaml exists (Typst yaml())", async () => {
        assertTypst();
        const workDir = join(tmpdir(), `typst-data-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("data-variations", "yaml.pdf");
        mkdirSync(workDir, { recursive: true });
        writeFileSync(mainPath, '#set page(width:100pt)\n#let d = yaml("data.yaml")\nHello, #d.name!');
        writeFileSync(join(workDir, "data.yaml"), "name: World\n");
        try {
            await compile(mainPath, output, { root: workDir });
            assert(existsSync(output));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles when config.toml exists (Typst toml())", async () => {
        assertTypst();
        const workDir = join(tmpdir(), `typst-data-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("data-variations", "toml.pdf");
        mkdirSync(workDir, { recursive: true });
        writeFileSync(mainPath, '#set page(width:100pt)\n#let d = toml("config.toml")\nTitle: #d.title');
        writeFileSync(join(workDir, "config.toml"), 'title = "Report"\n');
        try {
            await compile(mainPath, output, { root: workDir });
            assert(existsSync(output));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });
});
