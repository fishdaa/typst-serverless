/**
 * LocalStack E2E tests for Lambda handler.
 *
 * Sync mode (no DynamoDB): TYPST_USE_IN_MEMORY_STATE=1. Compile → immediate response.
 *   npm run test:localstack:sync
 *   - lambda only: typst required
 *   - lambda + S3: typst + LocalStack + scripts/localstack-setup.sh
 *
 * Async mode (DynamoDB + S3): status, retrieve, full workflow.
 *   localstack start && ./scripts/localstack-setup.sh && npm run test:localstack
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { handler } from "../../src/adapters/lambda-layer/handler.js";

const ENDPOINT = process.env.TYPST_AWS_ENDPOINT || process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
const INPUT_BUCKET = "typst-input-test";
const OUTPUT_BUCKET = "typst-output-test";
const FIXTURE_TYP = "#set page(width: 100pt)\nHello, LocalStack!";
const FIXTURE_B64 = Buffer.from(FIXTURE_TYP, "utf-8").toString("base64");
const SYNC_MODE = process.env.TYPST_USE_IN_MEMORY_STATE === "true" || process.env.TYPST_USE_IN_MEMORY_STATE === "1";

const s3 = new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    forcePathStyle: true,
});

function skipSync(): boolean {
    return !SYNC_MODE;
}
function skipAsync(): boolean {
    return SYNC_MODE;
}
function skipIfNoTypst(): boolean {
    return !process.env.TYPST_PATH && !process.env.CI;
}
function skipIfNoLocalStack(): boolean {
    return (!process.env.TYPST_AWS_ENDPOINT && !process.env.AWS_ENDPOINT_URL) || skipIfNoTypst();
}

describe("localstack e2e", () => {
    describe("sync mode (no DynamoDB)", () => {
        it("lambda only: compiles inline mainTyp and returns base64 PDF", async () => {
            if (skipSync() || skipIfNoTypst()) return;
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: "sync-lambda-only-1",
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.pdf, "expected base64 pdf in response");
            assert(Buffer.from(body.pdf, "base64").length > 0);
        });

        it("lambda + S3: compiles inline mainTyp and stores to S3", async () => {
            if (skipSync() || skipIfNoLocalStack()) return;
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: "sync-s3-1",
                storeToS3: true,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
        });

        it("lambda + S3: compiles mainTypS3 from S3 and stores output", async () => {
            if (skipSync() || skipIfNoLocalStack()) return;
            await s3.send(
                new PutObjectCommand({
                    Bucket: INPUT_BUCKET,
                    Key: "sources/main.typ",
                    Body: FIXTURE_TYP,
                    ContentType: "text/plain",
                })
            );
            const res = await handler({
                action: "compile",
                mainTypS3: { bucket: INPUT_BUCKET, key: "sources/main.typ" },
                documentId: "sync-s3-2",
                storeToS3: true,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
        });
    });

    describe("async mode (DynamoDB + S3)", () => {
        it("lambda only: compiles and status returns document", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            const docId = "async-status-1";
            await handler({ action: "compile", mainTyp: FIXTURE_B64, documentId: docId });
            const res = await handler({ action: "status", documentId: docId });
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.documentId, docId);
            assert.strictEqual(body.status, "completed");
        });

        it("lambda + S3: compiles inline mainTyp and stores to S3", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: "async-s3-1",
                storeToS3: true,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
        });

        it("lambda + S3: compiles mainTypS3 from S3 and stores output", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            await s3.send(
                new PutObjectCommand({
                    Bucket: INPUT_BUCKET,
                    Key: "sources/main.typ",
                    Body: FIXTURE_TYP,
                    ContentType: "text/plain",
                })
            );
            const res = await handler({
                action: "compile",
                mainTypS3: { bucket: INPUT_BUCKET, key: "sources/main.typ" },
                documentId: "async-s3-2",
                storeToS3: true,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
        });

        it("lambda + S3: compile → status → retrieve workflow", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            const docId = "async-workflow-1";
            const compileRes = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: docId,
                storeToS3: true,
            });
            assert.strictEqual(compileRes.statusCode, 200, compileRes.body);

            const statusRes = await handler({ action: "status", documentId: docId });
            assert.strictEqual(statusRes.statusCode, 200, statusRes.body);
            const statusBody = JSON.parse(statusRes.body);
            assert.strictEqual(statusBody.status, "completed");
            assert(statusBody.s3_key);

            const retrieveRes = await handler({ action: "retrieve", documentId: docId });
            assert.strictEqual(retrieveRes.statusCode, 200, retrieveRes.body);
            const retrieveBody = JSON.parse(retrieveRes.body);
            assert(retrieveBody.s3Url?.includes(OUTPUT_BUCKET));
        });
    });
});
