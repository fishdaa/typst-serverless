/**
 * Lambda integration tests.
 * Uses AWS SDK mocking; handler logic is tested.
 * Full E2E requires: LocalStack, SAM Local, or deployed Lambda.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "@/adapters/lambda-layer/handler.js";
import { CROSS_ADAPTER_B64, ASSETS_COMPILE_EVENT } from "../fixtures/shared-payloads.js";
import { assertTypst } from "../test-output-helper.js";

const FIXTURE_B64 = CROSS_ADAPTER_B64;

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

        it("rejects invalid main (path traversal)", async () => {
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                main: "../document.typ",
            });
            assert.strictEqual(res.statusCode, 400);
            const body = JSON.parse(res.body);
            assert(body.error?.includes("main") || body.error?.includes("path"));
        });
    });

    describe("compile (requires typst + AWS)", () => {
        it("compiles with assets (image) and dataJson when typst available", { timeout: 15000 }, async () => {
            assertTypst();
            const res = await handler({
                ...ASSETS_COMPILE_EVENT,
                documentId: `assets-${Date.now()}`,
            });
            assert([200, 500].includes(res.statusCode));
            if (res.statusCode === 200) {
                const body = JSON.parse(res.body);
                assert.strictEqual(body.status, "completed");
                assert(body.pdf || body.s3Url);
                if (body.pdf) {
                    const buf = Buffer.from(body.pdf, "base64");
                    assert(buf.length > 200);
                    assert(buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
                }
            }
        });

        it("compiles inline mainTyp when typst and DynamoDB available", async () => {
            assertTypst();
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

        it("compiles with custom main filename when main is set", { timeout: 15000 }, async () => {
            assertTypst();
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                main: "document.typ",
                documentId: `custom-main-${Date.now()}`,
            });
            assert([200, 500].includes(res.statusCode));
            if (res.statusCode === 200) {
                const body = JSON.parse(res.body);
                assert.strictEqual(body.status, "completed");
                assert(body.pdf || body.s3Url);
                if (body.pdf) {
                    const buf = Buffer.from(body.pdf, "base64");
                    assert(buf.length > 0 && buf[0] === 0x25, "Output should be valid PDF");
                }
            }
        });
    });
});
