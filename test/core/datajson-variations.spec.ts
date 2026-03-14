/**
 * Phase 6.3: dataJson variations.
 * Core: compile with data.json present (Typst reads via context read).
 * dataJson base64/S3 resolution is tested in lambda.spec.ts.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getOutputPathAndDir, shouldKeepOutput } from "../test-output-helper.js";

const __testDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__testDir, "../fixtures");

function skipWithoutTypst() {
    if (!process.env.TYPST_PATH && process.env.CI) return true;
    return false;
}

describe("core dataJson variations", () => {
    it("compiles when data.json exists with minimal JSON", async () => {
        if (skipWithoutTypst()) return;
        const workDir = join(tmpdir(), `typst-datajson-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("datajson-variations", "minimal.pdf");
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
        if (skipWithoutTypst()) return;
        const workDir = join(tmpdir(), `typst-datajson-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("datajson-variations", "nested.pdf");
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
        if (skipWithoutTypst()) return;
        const workDir = join(tmpdir(), `typst-datajson-${randomUUID()}`);
        const mainPath = join(workDir, "main.typ");
        const { output, outDir } = getOutputPathAndDir("datajson-variations", "empty.pdf");
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
});
