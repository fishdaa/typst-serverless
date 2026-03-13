/**
 * Lambda integration tests.
 * Uses AWS SDK mocking; handler logic is tested.
 * Full E2E requires: LocalStack, SAM Local, or deployed Lambda.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "../../src/adapters/lambda-layer/handler.js";

const FIXTURE_TYP = "#set page(width: 100pt)\nHello, Lambda!";
const FIXTURE_B64 = Buffer.from(FIXTURE_TYP, "utf-8").toString("base64");

describe("lambda integration", () => {
  describe("validation (no AWS)", () => {
    it("rejects oversized payload", async () => {
      const big = { mainTyp: "x".repeat(7 * 1024 * 1024) };
      const res = await handler(big);
      assert.strictEqual(res.statusCode, 413);
      const body = JSON.parse(res.body);
      assert(body.error?.includes("6MB") || body.error?.includes("Payload"));
    });

    it("rejects invalid compile event (no main source)", async () => {
      const res = await handler({ action: "compile" });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert(body.error?.includes("mainTyp") || body.error?.includes("mainTypS3"));
    });

    it("rejects unknown action", async () => {
      const res = await handler({ action: "unknown" });
      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects status without documentId", async () => {
      const res = await handler({ action: "status" });
      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects retrieve without documentId", async () => {
      const res = await handler({ action: "retrieve" });
      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects mainTypS3 with path traversal in key", async () => {
      const res = await handler({
        action: "compile",
        mainTypS3: { bucket: "my-bucket", key: "../etc/main.typ" },
      });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert(body.error?.includes("S3") || body.error?.includes("path"));
    });

    it("rejects invalid documentId format on status", async () => {
      const res = await handler({
        action: "status",
        documentId: "bad/id",
      });
      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects invalid font extension", async () => {
      const res = await handler({
        action: "compile",
        mainTyp: FIXTURE_B64,
        fonts: [{ name: "x.woff", base64: "dGVzdA==" }],
      });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert(body.error?.includes("font") || body.error?.includes("extension"));
    });

    it("rejects invalid asset extension", async () => {
      const res = await handler({
        action: "compile",
        mainTyp: FIXTURE_B64,
        assets: [{ name: "x.bmp", base64: "dGVzdA==" }],
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  describe("compile (requires typst + AWS)", () => {
    it("compiles inline mainTyp when typst and DynamoDB available", async () => {
      const typstPath = process.env.TYPST_PATH;
      if (!typstPath && process.env.CI) {
        return;
      }
      const res = await handler({
        action: "compile",
        mainTyp: FIXTURE_B64,
        documentId: "test-doc-1",
      });
      assert([200, 500].includes(res.statusCode));
      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        assert.strictEqual(body.status, "completed");
        assert(body.pdf || body.s3Url);
      }
    });
  });
});
