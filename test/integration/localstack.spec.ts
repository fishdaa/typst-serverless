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
import { S3Client, PutObjectCommand, GetObjectCommand, ListBucketsCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { handler } from "@/adapters/lambda-layer/handler.js";
import { assertTypst } from "../test-output-helper.js";

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
function skipIfNoLocalStack(): boolean {
    return !process.env.TYPST_AWS_ENDPOINT && !process.env.AWS_ENDPOINT_URL;
}

/** Asserts LocalStack is reachable and S3 output/input buckets exist. Fails the test with a clear message if not. */
async function assertLocalStackS3Available(): Promise<void> {
    try {
        await s3.send(new ListBucketsCommand({}));
    } catch (e) {
        assert.fail(`LocalStack not available (S3 ListBuckets failed): ${(e as Error).message}`);
    }
    try {
        await s3.send(new HeadBucketCommand({ Bucket: OUTPUT_BUCKET }));
    } catch (e) {
        assert.fail(`S3 output bucket "${OUTPUT_BUCKET}" not present (run scripts/localstack-setup.sh): ${(e as Error).message}`);
    }
    try {
        await s3.send(new HeadBucketCommand({ Bucket: INPUT_BUCKET }));
    } catch (e) {
        assert.fail(`S3 input bucket "${INPUT_BUCKET}" not present (run scripts/localstack-setup.sh): ${(e as Error).message}`);
    }
}

describe("localstack e2e", () => {
    describe("sync mode (no DynamoDB)", () => {
        it("lambda only: compiles inline mainTyp and returns base64 PDF", async () => {
            if (skipSync()) return;
            assertTypst();
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
            await assertLocalStackS3Available();
            assertTypst();
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
            await assertLocalStackS3Available();
            assertTypst();
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

        it("lambda + S3: stores output at custom outputKey when provided", async () => {
            if (skipSync() || skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            assertTypst();
            const customKey = "reports/custom-output.pdf";
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: "sync-outputkey-1",
                storeToS3: true,
                outputKey: customKey,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
            const getRes = await s3.send(
                new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: customKey })
            );
            const outBuf = await getRes.Body?.transformToByteArray();
            assert(outBuf && outBuf.length > 0, "Object should exist at custom key");
            assert(outBuf[0] === 0x25 && outBuf[1] === 0x50, "Object at custom key should be PDF (%PDF)");
        });
    });

    describe("async mode (DynamoDB + S3)", () => {
        it("lambda only: compiles and status returns document", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            assertTypst();
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
            await assertLocalStackS3Available();
            assertTypst();
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
            await assertLocalStackS3Available();
            assertTypst();
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
            await assertLocalStackS3Available();
            assertTypst();
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

        it("lambda + S3: stores output at custom outputKey when provided", async () => {
            if (skipAsync() || skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            assertTypst();
            const customKey = "reports/async-custom-output.pdf";
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                documentId: "async-outputkey-1",
                storeToS3: true,
                outputKey: customKey,
            });
            assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.s3Url?.includes(OUTPUT_BUCKET));
            const getRes = await s3.send(
                new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: customKey })
            );
            const outBuf = await getRes.Body?.transformToByteArray();
            assert(outBuf && outBuf.length > 0, "Object should exist at custom key");
            assert(outBuf[0] === 0x25 && outBuf[1] === 0x50, "Object at custom key should be PDF (%PDF)");
        });
    });

    describe("asset cache (S3)", () => {
        it("uploads, lists, resolves by assetPath in compile, then deletes", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            assertTypst();
            const assetPath = `cache-test/main-${Date.now()}.typ`;

            const uploadRes = await handler({
                action: "uploadasset",
                assetPath,
                base64: FIXTURE_B64,
                contentType: "text/plain",
            });
            assert.strictEqual(uploadRes.statusCode, 200, uploadRes.body);
            const uploadBody = JSON.parse(uploadRes.body);
            assert.strictEqual(uploadBody.assetPath, assetPath);

            const listRes = await handler({ action: "listassets", prefix: "cache-test/" });
            assert.strictEqual(listRes.statusCode, 200, listRes.body);
            const listBody = JSON.parse(listRes.body);
            assert(listBody.assets.some((a: { assetPath: string }) => a.assetPath === assetPath));

            const compileRes = await handler({
                action: "compile",
                mainTypAssetPath: assetPath,
                documentId: `cache-compile-${Date.now()}`,
            });
            assert.strictEqual(compileRes.statusCode, 200, compileRes.body);
            const compileBody = JSON.parse(compileRes.body);
            assert.strictEqual(compileBody.status, "completed");

            const deleteRes = await handler({ action: "deleteasset", assetPath });
            assert.strictEqual(deleteRes.statusCode, 200, deleteRes.body);

            const listAfterRes = await handler({ action: "listassets", prefix: "cache-test/" });
            const listAfterBody = JSON.parse(listAfterRes.body);
            assert(!listAfterBody.assets.some((a: { assetPath: string }) => a.assetPath === assetPath));
        });

        it("presigns an asset upload, PUTs directly to S3, then compiles it", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            assertTypst();
            const assetPath = `cache-test/presigned-${Date.now()}.typ`;
            const body = Buffer.from(FIXTURE_TYP, "utf-8");

            const presignRes = await handler({
                action: "presignuploadasset",
                assetPath,
                contentType: "text/plain",
                sizeBytes: body.length,
            });
            assert.strictEqual(presignRes.statusCode, 200, presignRes.body);
            const presigned = JSON.parse(presignRes.body);
            assert(presigned.uploadUrl?.includes("X-Amz-Signature"), "should return a signed URL");
            assert.strictEqual(presigned.sizeBytes, body.length);
            assert.strictEqual(presigned.headers["Content-Length"], String(body.length));
            assert(Date.parse(presigned.expiresAt) > Date.now(), "expiresAt should be in the future");

            const putRes = await fetch(presigned.uploadUrl, {
                method: "PUT",
                headers: presigned.headers,
                body,
            });
            assert.strictEqual(putRes.status, 200, `direct PUT failed: ${await putRes.text()}`);

            // The object must be resolvable by assetPath exactly like a base64 upload.
            const compileRes = await handler({
                action: "compile",
                mainTypAssetPath: assetPath,
                documentId: `presign-compile-${Date.now()}`,
            });
            assert.strictEqual(compileRes.statusCode, 200, compileRes.body);
            assert.strictEqual(JSON.parse(compileRes.body).status, "completed");

            await handler({ action: "deleteasset", assetPath });
        });

        it("presigns a batch of asset uploads in one call", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            const stamp = Date.now();
            const paths = [`cache-test/batch-a-${stamp}.typ`, `cache-test/batch-b-${stamp}.typ`];
            const body = Buffer.from(FIXTURE_TYP, "utf-8");

            const res = await handler({
                action: "presignuploadasset",
                assets: paths.map((assetPath) => ({
                    assetPath,
                    contentType: "text/plain",
                    sizeBytes: body.length,
                })),
            });
            assert.strictEqual(res.statusCode, 200, res.body);
            const { uploads } = JSON.parse(res.body);
            assert.strictEqual(uploads.length, 2);
            assert.deepStrictEqual(uploads.map((u: { assetPath: string }) => u.assetPath), paths);

            for (const upload of uploads) {
                const putRes = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body });
                assert.strictEqual(putRes.status, 200, `PUT ${upload.assetPath} failed`);
            }

            const listRes = await handler({ action: "listassets", prefix: "cache-test/batch-" });
            const listed = JSON.parse(listRes.body).assets.map((a: { assetPath: string }) => a.assetPath);
            for (const p of paths) assert(listed.includes(p), `${p} should be listed`);

            for (const p of paths) await handler({ action: "deleteasset", assetPath: p });
        });

        it("registers an existing S3 object under an assetPath via bucket+key", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            const sourceKey = `sources/register-src-${Date.now()}.typ`;
            await s3.send(
                new PutObjectCommand({ Bucket: INPUT_BUCKET, Key: sourceKey, Body: FIXTURE_TYP, ContentType: "text/plain" })
            );
            const assetPath = `cache-test/registered-${Date.now()}.typ`;

            const res = await handler({
                action: "uploadasset",
                assetPath,
                bucket: INPUT_BUCKET,
                key: sourceKey,
            });
            assert.strictEqual(res.statusCode, 200, res.body);

            const getRes = await s3.send(
                new GetObjectCommand({ Bucket: INPUT_BUCKET, Key: `assets/${assetPath}` })
            );
            const buf = await getRes.Body?.transformToByteArray();
            assert(buf);
            assert.strictEqual(Buffer.from(buf).toString("utf-8"), FIXTURE_TYP);

            await handler({ action: "deleteasset", assetPath });
        });
    });
    describe("presigned job uploads (S3)", () => {
        const IMAGE_TYP = '#set page(width: 120pt, height: 120pt, margin: 4pt)\n#image("bg.svg", width: 100%)\n= Poster\n';
        // 1x1 sliver of SVG: small enough to inline here, real enough for typst to embed.
        const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#7c3aed"/></svg>';

        /** Presigns job uploads, PUTs each body directly to S3, returns the jobId. */
        async function uploadJobFiles(files: Array<{ name: string; contentType: string; body: Buffer }>): Promise<string> {
            const presignRes = await handler({
                action: "presignuploads",
                files: files.map((f) => ({ name: f.name, contentType: f.contentType, sizeBytes: f.body.length })),
            });
            assert.strictEqual(presignRes.statusCode, 200, presignRes.body);
            const { jobId, uploads } = JSON.parse(presignRes.body);
            assert(jobId, "should mint a jobId");
            assert.strictEqual(uploads.length, files.length);
            for (const upload of uploads) {
                const file = files.find((f) => f.name === upload.name);
                assert(file, `unexpected upload entry ${upload.name}`);
                assert.deepStrictEqual(upload.uploadRef, { jobId, name: upload.name });
                const putRes = await fetch(upload.uploadUrl, {
                    method: "PUT",
                    headers: upload.headers,
                    body: file.body,
                });
                assert.strictEqual(putRes.status, 200, `PUT ${upload.name} failed: ${await putRes.text()}`);
            }
            return jobId;
        }

        it("lands uploads under uploads/<jobId>/, not in the asset library", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            const jobId = await uploadJobFiles([
                { name: "main.typ", contentType: "text/plain", body: Buffer.from(FIXTURE_TYP, "utf-8") },
            ]);

            const getRes = await s3.send(
                new GetObjectCommand({ Bucket: INPUT_BUCKET, Key: `uploads/${jobId}/main.typ` })
            );
            const buf = await getRes.Body?.transformToByteArray();
            assert(buf);
            assert.strictEqual(Buffer.from(buf).toString("utf-8"), FIXTURE_TYP);

            // Ephemeral uploads must not show up as library assets.
            const listRes = await handler({ action: "listassets" });
            const listed = JSON.parse(listRes.body).assets.map((a: { assetPath: string }) => a.assetPath);
            assert(!listed.some((p: string) => p.includes(jobId)), "job uploads should not appear in the asset library");
        });

        it("sync compile resolves mainTypUploadRef, assets and data by uploadRef", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            assertTypst();
            const jobId = await uploadJobFiles([
                { name: "main.typ", contentType: "text/plain", body: Buffer.from(IMAGE_TYP, "utf-8") },
                { name: "bg.svg", contentType: "image/svg+xml", body: Buffer.from(SVG, "utf-8") },
            ]);

            const res = await handler({
                action: "compile",
                mainTypUploadRef: { jobId, name: "main.typ" },
                assets: [{ name: "bg.svg", uploadRef: { jobId, name: "bg.svg" } }],
                documentId: `job-sync-${Date.now()}`,
            });
            assert.strictEqual(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.strictEqual(body.status, "completed");
            assert(body.pdf || body.s3Url, "should return output");
        });

        it("rejects a compile whose presigned upload never completed", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            // Presign but deliberately skip the PUT.
            const presignRes = await handler({
                action: "presignuploads",
                files: [{ name: "main.typ", contentType: "text/plain", sizeBytes: 10 }],
            });
            const { jobId } = JSON.parse(presignRes.body);

            const res = await handler({
                action: "compile",
                mainTypUploadRef: { jobId, name: "main.typ" },
                documentId: `job-missing-${Date.now()}`,
            });
            // 400, not 500: the upload is the caller's responsibility.
            assert.strictEqual(res.statusCode, 400, res.body);
            const body = JSON.parse(res.body);
            assert(body.error?.includes("not found"), body.error);
            assert(body.error?.includes(`uploads/${jobId}/main.typ`), body.error);
            assert.strictEqual(body.status, "failed");
        });

        it("rejects a compile referencing an asset that is not in the library", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                assets: [{ name: "logo.png", assetPath: `never-uploaded-${Date.now()}.png` }],
                documentId: `asset-missing-${Date.now()}`,
            });
            assert.strictEqual(res.statusCode, 400, res.body);
            assert(JSON.parse(res.body).error?.includes("not found"));
        });

        it("names every missing input, not just the first", async () => {
            if (skipIfNoLocalStack()) return;
            await assertLocalStackS3Available();
            const stamp = Date.now();
            const res = await handler({
                action: "compile",
                mainTyp: FIXTURE_B64,
                assets: [
                    { name: "a.png", assetPath: `missing-a-${stamp}.png` },
                    { name: "b.png", assetPath: `missing-b-${stamp}.png` },
                ],
                documentId: `multi-missing-${stamp}`,
            });
            assert.strictEqual(res.statusCode, 400, res.body);
            const { error } = JSON.parse(res.body);
            assert(error.includes(`missing-a-${stamp}.png`), error);
            assert(error.includes(`missing-b-${stamp}.png`), error);
        });
    });
});
