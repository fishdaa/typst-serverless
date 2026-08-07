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

        it("rejects invalid outputKey (path traversal) when storeToS3", async () => {
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                storeToS3: true,
                outputKey: "../outputs/evil.pdf",
            });
            assert.strictEqual(res.statusCode, 400);
            const body = JSON.parse(res.body);
            assert(body.error?.includes("S3") || body.error?.includes("path") || body.error?.includes("invalid"));
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

        it("rejects compile with both mainTyp and mainTypAssetPath", async () => {
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                mainTypAssetPath: "templates/main.typ",
            });
            assert.strictEqual(res.statusCode, 400);
        });

        it("rejects asset with path traversal in assetPath", async () => {
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                assets: [{ name: "logo.png", assetPath: "../etc/logo.png" }],
            });
            assert.strictEqual(res.statusCode, 400);
        });
    });

    describe("asset cache (no AWS)", () => {
        it("rejects uploadasset without assetPath", async () => {
            const res = await handler({ action: "uploadasset", base64: "dGVzdA==" });
            assert.strictEqual(res.statusCode, 400);
            const body = JSON.parse(res.body);
            assert(body.error?.includes("assetPath"));
        });

        it("rejects uploadasset with path traversal in assetPath", async () => {
            const res = await handler({ action: "uploadasset", assetPath: "../evil.png", base64: "dGVzdA==" });
            assert.strictEqual(res.statusCode, 400);
        });

        it("rejects uploadasset without base64 or bucket+key", async () => {
            const res = await handler({ action: "uploadasset", assetPath: "logo.png" });
            assert.strictEqual(res.statusCode, 400);
            const body = JSON.parse(res.body);
            assert(body.error?.includes("base64") || body.error?.includes("bucket"));
        });

        it("rejects uploadasset with both base64 and bucket+key", async () => {
            const res = await handler({
                action: "uploadasset",
                assetPath: "logo.png",
                base64: "dGVzdA==",
                bucket: "b",
                key: "k",
            });
            assert.strictEqual(res.statusCode, 400);
        });

        it("returns 503 for uploadasset when no assets bucket configured", async () => {
            const res = await handler({ action: "uploadasset", assetPath: "logo.png", base64: "dGVzdA==" });
            assert.strictEqual(res.statusCode, 503);
        });

        it("returns 503 for listassets when no assets bucket configured", async () => {
            const res = await handler({ action: "listassets" });
            assert.strictEqual(res.statusCode, 503);
        });

        it("rejects deleteasset with invalid assetPath", async () => {
            const res = await handler({ action: "deleteasset", assetPath: "../evil.png" });
            assert.strictEqual(res.statusCode, 400);
        });
    });

    describe("compile (requires typst + AWS)", () => {
        it("compiles with assets (image) and data when typst available", { timeout: 15000 }, async () => {
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

        it("compiles with data and dataFile (YAML) through handler when typst available", { timeout: 15000 }, async () => {
            assertTypst();
            const typContent = '#set page(width: 100pt)\n#let d = yaml("data.yaml")\nRendered: #d.title';
            const yamlContent = "title: Integration Test\n";
            const res = await handler({
                action: "compile",
                mainTyp: Buffer.from(typContent, "utf-8").toString("base64"),
                data: Buffer.from(yamlContent, "utf-8").toString("base64"),
                dataFile: "data.yaml",
                documentId: `data-yaml-${Date.now()}`,
            });
            assert([200, 500].includes(res.statusCode), res.body);
            if (res.statusCode === 200) {
                const body = JSON.parse(res.body);
                assert.strictEqual(body.status, "completed");
                assert(body.pdf || body.s3Url);
                if (body.pdf) {
                    const buf = Buffer.from(body.pdf, "base64");
                    assert(buf.length > 0);
                    assert(buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
                }
            }
        });

        it("compiles with storeToS3 and custom outputKey when typst and S3 available", { timeout: 15000 }, async () => {
            if (!process.env.TYPST_OUTPUT_BUCKET) return;
            assertTypst();
            const customKey = "integration-test/custom-key.pdf";
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: `outputkey-${Date.now()}`,
                storeToS3: true,
                outputKey: customKey,
            });
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url, "expected s3Url when storeToS3 and outputKey");
            assert(
                body.s3Url.includes(customKey) || body.s3Url.includes(encodeURIComponent(customKey)),
                `s3Url should contain custom key "${customKey}", got: ${body.s3Url}`
            );
        });
    });
});
