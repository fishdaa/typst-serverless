/**
 * Integration tests: output variants, webhooks, batch (Phase 4 features).
 * With TYPST_TEST_KEEP_OUTPUT=1, outputs written to test-output/<timestamp>/output-variants/, test-output/<timestamp>/batch/
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "@/adapters/lambda-layer/handler.js";
import { compile } from "@/core/compile.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __testDir = dirname(fileURLToPath(import.meta.url));
import { rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { getOutputPathAndDir, shouldKeepOutput } from "../test-output-helper.js";
import { CROSS_ADAPTER_B64 } from "../fixtures/shared-payloads.js";

const FIXTURES = join(__testDir, "../fixtures");
const FIXTURE_B64 = CROSS_ADAPTER_B64;

describe("output variants", () => {
    it("compiles to PDF with --pdf-standard a-2b when pdfStandard given", async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;
        const { output, outDir } = getOutputPathAndDir("output-variants", "pdf-a2b.pdf");
        try {
            const input = join(FIXTURES, "minimal.typ");
            await compile(input, output, { pdfStandard: "a-2b" });
            assert(existsSync(output));
            const buf = readFileSync(output);
            assert(buf.length > 0);
            assert(buf[0] === 0x25 && buf[1] === 0x50, "PDF header %P");
        } finally {
            if (!shouldKeepOutput()) rmSync(outDir, { recursive: true, force: true });
        }
    });

    it("compiles to SVG when format is svg", async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;
        const { output, outDir } = getOutputPathAndDir("output-variants", "out.svg");
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

    it("compiles to PNG when format is png", async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;
        const { output, outDir } = getOutputPathAndDir("output-variants", "out.png");
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

describe("webhooks", () => {
    it("validates webhook URL format", async () => {
        const res = await handler({
            action: "compile",
            mainTyp: FIXTURE_B64,
            webhook: { url: "not-a-valid-url" },
        });
        assert([400, 500].includes(res.statusCode));
    });

    it("rejects webhook with non-https URL when enforceHttps", async () => {
        const res = await handler({
            action: "compile",
            mainTyp: FIXTURE_B64,
            webhook: { url: "http://example.com/cb" },
        });
        assert([400, 500].includes(res.statusCode));
    });

    it("accepts webhook URL when valid https (compile may fail without DynamoDB)", async () => {
        const url = `https://example.com/webhook`;
        const res = await handler({
            action: "compile",
            mainTyp: FIXTURE_B64,
            webhook: { url },
        });
        assert([200, 500].includes(res.statusCode), "compile with valid webhook URL should not return 400");
    });
});

describe("batch", () => {
    it("validates batch event structure", async () => {
        const res = await handler({
            action: "batch",
            documents: "not-an-array",
        } as { action: string; documents: unknown });
        assert.strictEqual(res.statusCode, 400);
        const body = JSON.parse(res.body);
        assert(body.error?.includes("documents") || body.error?.includes("array"));
    });

    it("rejects batch with empty documents array", async () => {
        const res = await handler({
            action: "batch",
            documents: [],
        });
        assert.strictEqual(res.statusCode, 400);
    });

    it("processes batch and returns results array", async () => {
        const res = await handler({
            action: "batch",
            documents: [{ mainTypS3: { bucket: "b", key: "k" } }],
        });
        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert(Array.isArray(body.results));
        assert.strictEqual(body.results.length, 1);
    });

    it("returns results for batch with valid documents", { timeout: 30000 }, async () => {
        const res = await handler({
            action: "batch",
            documents: [{ mainTyp: FIXTURE_B64 }, { mainTyp: FIXTURE_B64 }],
        });
        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert(Array.isArray(body.results));
        assert.strictEqual(body.results.length, 2);
        body.results.forEach((r: { documentId?: string; status: string; pdf?: string }) => {
            assert(r.documentId, "each result should have documentId");
            assert(["completed", "failed"].includes(r.status));
            if (shouldKeepOutput() && r.pdf) {
                const { output } = getOutputPathAndDir("batch", `batch-2docs-${r.documentId}.pdf`);
                writeFileSync(output, Buffer.from(r.pdf, "base64"));
            }
        });
    });
});

describe("batch variations", () => {
    const TYP_A = "#set page(width: 80pt)\nDoc A";
    const TYP_B = "#set page(width: 90pt)\nDoc B";
    const TYP_C = "#set page(width: 100pt)\nDoc C";

    it("batch: mixed content, 3 docs", { timeout: 30000 }, async () => {
        const res = await handler({
            action: "batch",
            documents: [
                { mainTyp: Buffer.from(TYP_A, "utf-8").toString("base64") },
                { mainTyp: Buffer.from(TYP_B, "utf-8").toString("base64") },
                { mainTyp: Buffer.from(TYP_C, "utf-8").toString("base64") },
            ],
        });
        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.results.length, 3);
        if (shouldKeepOutput()) {
            body.results.forEach((r: { documentId?: string; pdf?: string }, i: number) => {
                if (r.pdf) {
                    const { output } = getOutputPathAndDir("batch", `batch-mixed-doc-${i}.pdf`);
                    writeFileSync(output, Buffer.from(r.pdf, "base64"));
                }
            });
        }
    });

    it("batch: single doc", { timeout: 15000 }, async () => {
        const res = await handler({
            action: "batch",
            documents: [{ mainTyp: FIXTURE_B64 }],
        });
        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.results.length, 1);
        assert(body.results[0].documentId);
        const r = body.results[0] as { pdf?: string };
        if (shouldKeepOutput() && r?.pdf) {
            const { output } = getOutputPathAndDir("batch", "batch-single.pdf");
            writeFileSync(output, Buffer.from(r.pdf, "base64"));
        }
    });
});

describe("batch status (Phase 5)", () => {
    it("rejects batch status in sync/in-memory mode", async () => {
        if (process.env.TYPST_USE_IN_MEMORY_STATE !== "1" && process.env.TYPST_USE_IN_MEMORY_STATE !== "true") return;
        const res = await handler({
            action: "batchstatus",
            batchId: "test-batch-123",
        });
        assert.strictEqual(res.statusCode, 400);
        const body = JSON.parse(res.body);
        assert(body.error?.includes("in-memory") || body.error?.includes("sync"));
    });
});
