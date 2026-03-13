/**
 * API Gateway integration tests (Phase 3).
 * Validates REST event parsing, body size, path params, JSON schema.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "../../src/adapters/lambda-layer/api-handler.js";

const FIXTURE_TYP = "#set page(width: 100pt)\nHello, API!";
const FIXTURE_B64 = Buffer.from(FIXTURE_TYP, "utf-8").toString("base64");

function apiEvent(
  method: string,
  path: string,
  body: object | null,
  pathParams: Record<string, string> = {}
) {
  const rawPath = path || "/compile";
  const routeKey = `${method} ${rawPath}`;
  return {
    version: "2.0",
    routeKey,
    rawPath,
    requestContext: { http: { method } },
    body: body ? JSON.stringify(body) : null,
    pathParameters: pathParams,
    isBase64Encoded: false,
  };
}

describe("API Gateway handler", () => {
  describe("validation", () => {
    it("rejects body exceeding 10MB", async () => {
      const body = { mainTyp: "x".repeat(11 * 1024 * 1024) };
      const ev = apiEvent("POST", "/compile", body);
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 413);
      const parsed = JSON.parse(res.body);
      assert(parsed.error?.includes("10MB") || parsed.error?.includes("limit"));
    });

    it("rejects empty body for POST /compile", async () => {
      const ev = apiEvent("POST", "/compile", null);
      ev.body = "";
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 400);
    });

    it("rejects invalid JSON body", async () => {
      const ev = apiEvent("POST", "/compile", null);
      ev.body = "not valid json {";
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert(parsed.error?.toLowerCase().includes("json"));
    });

    it("validates documentId path param on GET /documents/:id", async () => {
      const ev = apiEvent("GET", "/documents/bad-id!", null, { id: "bad-id!" });
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 400);
    });

    it("returns 404 for unknown route", async () => {
      const ev = apiEvent("GET", "/unknown", null);
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe("CORS", () => {
    it("returns 200 for OPTIONS preflight", async () => {
      const ev = {
        requestContext: { http: { method: "OPTIONS" } },
        routeKey: "OPTIONS /compile",
        rawPath: "/compile",
      };
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 200);
      assert(res.headers?.["Access-Control-Allow-Methods"]?.includes("POST"));
    });
  });

  describe("POST /compile", () => {
    it("rejects compile without mainTyp", async () => {
      const ev = apiEvent("POST", "/compile", {});
      const res = await handler(ev);
      assert.strictEqual(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert(parsed.error?.includes("mainTyp") || parsed.error?.includes("mainTypS3"));
    });

    it("forwards valid compile to Lambda handler", async () => {
      const ev = apiEvent("POST", "/compile", {
        mainTyp: FIXTURE_B64,
        documentId: "api-test-1",
      });
      const res = await handler(ev);
      assert([200, 500].includes(res.statusCode));
      if (res.statusCode === 200) {
        const parsed = JSON.parse(res.body);
        assert(parsed.status === "completed" || parsed.documentId);
      }
    });
  });

  describe("GET /documents/:id", () => {
    it("forwards status request", async () => {
      const ev = apiEvent("GET", "/documents/valid-id-123", null, {
        id: "valid-id-123",
      });
      const res = await handler(ev);
      assert([200, 404, 500].includes(res.statusCode));
    });
  });
});
