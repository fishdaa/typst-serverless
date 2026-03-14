/**
 * Phase 6.1: Param variations across core compile.
 * Tests: outputFormat (pdf/svg/png), pdfStandard (a-2b, a-3b, 1.4, 1.5).
 * mainTyp base64 / mainTypS3 are tested in lambda.spec.ts and api.spec.ts.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { getOutputPathAndDir, shouldKeepOutput } from "../test-output-helper.js";

const __testDir = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__testDir, "../fixtures");

function skipWithoutTypst() {
    if (!process.env.TYPST_PATH && process.env.CI) return true;
    return false;
}

describe("core param variations", () => {
    describe("outputFormat", () => {
        it("compiles to PDF (default)", async () => {
            if (skipWithoutTypst()) return;
            const { output, outDir } = getOutputPathAndDir("param-variations", "out.pdf");
            try {
                const input = join(FIXTURES, "minimal.typ");
                await compile(input, output, { format: "pdf" });
                assert(existsSync(output));
                const buf = readFileSync(output);
                assert(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44, "PDF header %PD");
            } finally {
                if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
            }
        });

        it("compiles to SVG when format=svg", async () => {
            if (skipWithoutTypst()) return;
            const { output, outDir } = getOutputPathAndDir("param-variations", "out.svg");
            try {
                const input = join(FIXTURES, "minimal.typ");
                await compile(input, output, { format: "svg" });
                assert(existsSync(output));
                const content = readFileSync(output, "utf-8");
                assert(content.includes("<svg") || content.includes("<?xml"));
            } finally {
                if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
            }
        });

        it("compiles to PNG when format=png", async () => {
            if (skipWithoutTypst()) return;
            const { output, outDir } = getOutputPathAndDir("param-variations", "out.png");
            try {
                const input = join(FIXTURES, "minimal.typ");
                await compile(input, output, { format: "png" });
                assert(existsSync(output));
                const buf = readFileSync(output);
                assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e, "PNG header");
            } finally {
                if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
            }
        });
    });

    describe("pdfStandard", () => {
        const standards = ["a-2b", "a-3b", "1.4", "1.5"] as const;

        for (const std of standards) {
            it(`compiles with pdfStandard=${std}`, async () => {
                if (skipWithoutTypst()) return;
                const { output, outDir } = getOutputPathAndDir("param-variations", `pdf-${std.replace(".", "_")}.pdf`);
                try {
                    const input = join(FIXTURES, "minimal.typ");
                    await compile(input, output, { format: "pdf", pdfStandard: std });
                    assert(existsSync(output));
                    const buf = readFileSync(output);
                    assert(buf.length > 0);
                    assert(buf[0] === 0x25 && buf[1] === 0x50, "PDF header");
                } finally {
                    if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
                }
            });
        }
    });
});
