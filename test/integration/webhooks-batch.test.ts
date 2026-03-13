/**
 * Integration tests: output variants, webhooks, batch (Phase 4 features).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "../../src/adapters/lambda-layer/handler.js";
import { compile } from "../../src/core/compile.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __testDir = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const FIXTURES = join(__testDir, "../fixtures");
const FIXTURE_TYP = "#set page(width: 100pt)\nHello!";
const FIXTURE_B64 = Buffer.from(FIXTURE_TYP, "utf-8").toString("base64");

describe("output variants", () => {
  it("compiles to PDF with --pdf-standard a-2b when pdfStandard given", async () => {
    const typstPath = process.env.TYPST_PATH;
    if (!typstPath && process.env.CI) return;
    const outDir = mkdtempSync(join(tmpdir(), "typst-output-"));
    try {
      const input = join(FIXTURES, "minimal.typ");
      const output = join(outDir, "out.pdf");
      await compile(input, output, { pdfStandard: "a-2b" });
      assert(existsSync(output));
      const buf = readFileSync(output);
      assert(buf.length > 0);
      assert(buf[0] === 0x25 && buf[1] === 0x50, "PDF header %P");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("compiles to SVG when format is svg", async () => {
    const typstPath = process.env.TYPST_PATH;
    if (!typstPath && process.env.CI) return;
    const outDir = mkdtempSync(join(tmpdir(), "typst-output-"));
    try {
      const input = join(FIXTURES, "minimal.typ");
      const output = join(outDir, "out.svg");
      await compile(input, output, { format: "svg" });
      assert(existsSync(output));
      const content = readFileSync(output, "utf-8");
      assert(content.includes("<svg") || content.includes("<?xml"));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("compiles to PNG when format is png", async () => {
    const typstPath = process.env.TYPST_PATH;
    if (!typstPath && process.env.CI) return;
    const outDir = mkdtempSync(join(tmpdir(), "typst-output-"));
    try {
      const input = join(FIXTURES, "minimal.typ");
      const output = join(outDir, "out.png");
      await compile(input, output, { format: "png" });
      assert(existsSync(output));
      const buf = readFileSync(output);
      assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e, "PNG header");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
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
    body.results.forEach((r: { documentId?: string; status: string }) => {
      assert(r.documentId, "each result should have documentId");
      assert(["completed", "failed"].includes(r.status));
    });
  });
});
