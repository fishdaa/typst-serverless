/**
 * Presigned uploads on the asynchronous path (LocalStack).
 *
 * Covers the whole loop that the 256KB async payload limit makes mandatory:
 * presign → direct PUT to S3 → POST /batch (SQS enqueue) → SQS worker compile →
 * batch status with a presigned output URL. Also covers rejection at enqueue
 * time when an upload never landed.
 *
 * Requires LocalStack with S3 + SQS + DynamoDB:
 *   localstack start && ./scripts/localstack-setup.sh
 *   TYPST_AWS_ENDPOINT=http://localhost:4566 npx vitest run test/integration/presign-async.spec.ts
 *
 * Skips (rather than fails) when LocalStack is not configured, matching
 * localstack.spec.ts.
 */
import { describe, it, beforeAll } from "vitest";
import assert from "node:assert";
import {
    SQSClient,
    CreateQueueCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
import { S3Client, ListBucketsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { assertTypst } from "../test-output-helper.js";

const ENDPOINT = process.env.TYPST_AWS_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const INPUT_BUCKET = "typst-input-test";
const OUTPUT_BUCKET = "typst-output-test";
const STATE_TABLE = "typst-documents";
const QUEUE_NAME = "typst-presign-async-test";

const POSTER_TYP = '#set page(width: 120pt, height: 120pt, margin: 4pt)\n#image("bg.svg", width: 100%)\n= Booth\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#7c3aed"/></svg>';
const LOGO_PNG = readFileSync(new URL("../fixtures/logo.png", import.meta.url));

/**
 * The shape the cached-campaign demo produces: no per-poster content is baked
 * into the source, so one cached template serves the whole batch and each
 * document supplies only its own `poster.json`.
 */
const CAMPAIGN_TEMPLATE = `#set page(width: 120pt, height: 160pt, margin: 6pt)
#let poster = json("poster.json")
#place(top + left, image("background.png", width: 100%, height: 100%))
#align(center)[
  #block(fill: rgb(poster.accent), inset: 4pt)[#text(fill: white, weight: "bold")[#poster.title]]
  #text(size: 8pt)[#poster.subtitle]
]
`;

const awsConfig = {
    endpoint: ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
};
const sqs = new SQSClient(awsConfig);
const s3 = new S3Client({ ...awsConfig, forcePathStyle: true });
const dynamo = new DynamoDBClient(awsConfig);

type Handler = typeof import("@/adapters/lambda-layer/handler.js").handler;
let handler: Handler | null = null;
let queueUrl = "";
/** Set when LocalStack is unreachable or under-provisioned; every test then skips. */
let unavailable: string | null = ENDPOINT ? null : "TYPST_AWS_ENDPOINT not set";

beforeAll(async () => {
    if (unavailable) return;
    try {
        await s3.send(new ListBucketsCommand({}));
        await dynamo.send(new DescribeTableCommand({ TableName: STATE_TABLE }));
        const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
        queueUrl = QueueUrl || "";
    } catch (e) {
        unavailable = `LocalStack S3/SQS/DynamoDB not available: ${(e as Error).message}`;
        return;
    }
    // The handler reads its wiring from env at module load, so configure the
    // batch queue before importing it.
    process.env.TYPST_BATCH_QUEUE_URL = queueUrl;
    process.env.TYPST_OUTPUT_BUCKET = OUTPUT_BUCKET;
    process.env.TYPST_ASSETS_BUCKET = INPUT_BUCKET;
    delete process.env.TYPST_USE_IN_MEMORY_STATE;
    process.env.TYPST_STATE_TABLE = STATE_TABLE;
    ({ handler } = await import("@/adapters/lambda-layer/handler.js"));
});

function skip(): boolean {
    return unavailable !== null;
}

function call(event: Record<string, unknown>) {
    assert(handler, "handler should be loaded");
    return handler(event as Parameters<Handler>[0], {});
}

/** Presigns job uploads and PUTs each body straight to S3. Returns the jobId. */
async function uploadJobFiles(files: Array<{ name: string; contentType: string; body: Buffer }>): Promise<string> {
    const res = await call({
        action: "presignuploads",
        files: files.map((f) => ({ name: f.name, contentType: f.contentType, sizeBytes: f.body.length })),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const { jobId, uploads } = JSON.parse(res.body);
    for (const upload of uploads) {
        const file = files.find((f) => f.name === upload.name);
        assert(file, `unexpected presigned entry ${upload.name}`);
        const putRes = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file.body });
        assert.strictEqual(putRes.status, 200, `PUT ${upload.name} failed: ${await putRes.text()}`);
    }
    return jobId;
}

async function drainQueue(): Promise<Array<{ body: string; receiptHandle: string }>> {
    const messages: Array<{ body: string; receiptHandle: string }> = [];
    for (let i = 0; i < 10; i++) {
        const { Messages } = await sqs.send(
            new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0 })
        );
        if (!Messages || Messages.length === 0) break;
        for (const m of Messages) {
            messages.push({ body: m.Body || "", receiptHandle: m.ReceiptHandle || "" });
        }
    }
    return messages;
}

describe("presigned uploads on the async path", () => {
    it("rejects the enqueue when a referenced upload never landed", async () => {
        if (skip()) return;
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));

        // Presign, then deliberately skip the PUT.
        const presignRes = await call({
            action: "presignuploads",
            files: [{ name: "main.typ", contentType: "text/plain", sizeBytes: 12 }],
        });
        const { jobId } = JSON.parse(presignRes.body);

        const res = await call({
            action: "batch",
            storeToS3: true,
            documents: [{ mainTypUploadRef: { jobId, name: "main.typ" }, storeToS3: true }],
        });
        assert.strictEqual(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert(body.error?.includes(`uploads/${jobId}/main.typ`), body.error);

        // Nothing may reach the queue: the point of verifying at enqueue time is
        // that the caller learns now, not through per-document status polling.
        const messages = await drainQueue();
        assert.strictEqual(messages.length, 0, `expected an empty queue, got ${messages.length} message(s)`);
    });

    it("enqueues documents that reference uploads, and the SQS worker compiles them", async () => {
        if (skip()) return;
        assertTypst();
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));

        const jobId = await uploadJobFiles([
            { name: "main.typ", contentType: "text/plain", body: Buffer.from(POSTER_TYP, "utf-8") },
            { name: "bg.svg", contentType: "image/svg+xml", body: Buffer.from(SVG, "utf-8") },
        ]);

        // Two documents sharing one uploaded background — the batch shape the
        // poster demo produces.
        const documents = [0, 1].map((i) => ({
            documentId: `presign-async-${Date.now()}-${i}`,
            mainTypUploadRef: { jobId, name: "main.typ" },
            assets: [{ name: "bg.svg", uploadRef: { jobId, name: "bg.svg" } }],
            storeToS3: true,
        }));

        const enqueueRes = await call({ action: "batch", storeToS3: true, documents });
        assert.strictEqual(enqueueRes.statusCode, 200, enqueueRes.body);
        const { batchId, documentIds } = JSON.parse(enqueueRes.body);
        assert(batchId, "should return a batchId");
        assert.strictEqual(documentIds.length, 2);

        const messages = await drainQueue();
        assert.strictEqual(messages.length, 2, `expected 2 enqueued messages, got ${messages.length}`);

        // The refs must survive the round trip through SQS unchanged, otherwise
        // the worker cannot resolve them.
        const firstMessage = messages[0];
        assert(firstMessage, "expected at least one enqueued message");
        const first = JSON.parse(firstMessage.body);
        assert.deepStrictEqual(first.mainTypUploadRef, { jobId, name: "main.typ" });
        assert.strictEqual(first.batchId, batchId);

        // Drive the worker exactly as the SQS event source would.
        const sqsRes = await call({
            action: "sqs",
            records: messages.map((m) => ({ body: m.body })),
        });
        assert.strictEqual(sqsRes.statusCode, 200, sqsRes.body);
        for (const m of messages) {
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.receiptHandle }));
        }

        const statusRes = await call({ action: "batchstatus", batchId });
        assert.strictEqual(statusRes.statusCode, 200, statusRes.body);
        const { results } = JSON.parse(statusRes.body);
        assert.strictEqual(results.length, 2, statusRes.body);
        for (const r of results) {
            assert.strictEqual(r.status, "completed", `document ${r.documentId}: ${r.error}`);
            assert(r.s3Url?.includes(OUTPUT_BUCKET), `expected a presigned output URL, got ${r.s3Url}`);
        }
    });

    /**
     * Cached-campaign shape: the shared inputs live in the persistent asset
     * library (uploaded through presigned PUTs) and only the per-poster JSON
     * travels in the request. Verifies both that the batch compiles and that
     * each document actually rendered its own data.
     */
    it("compiles a batch against one cached template and background, with per-document data", async () => {
        if (skip()) return;
        assertTypst();
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));

        const cacheId = `campaign-${Date.now()}`;
        const shared = [
            { name: "template.typ", contentType: "text/plain", body: Buffer.from(CAMPAIGN_TEMPLATE, "utf-8") },
            { name: "background.png", contentType: "image/png", body: LOGO_PNG },
        ];
        const assetPathFor = (name: string) => `${cacheId}/${name}`;

        // One presign call for every shared input, then direct PUTs.
        const presignRes = await call({
            action: "presignuploadasset",
            assets: shared.map((f) => ({
                assetPath: assetPathFor(f.name),
                contentType: f.contentType,
                sizeBytes: f.body.length,
            })),
        });
        assert.strictEqual(presignRes.statusCode, 200, presignRes.body);
        const { uploads } = JSON.parse(presignRes.body);
        for (const upload of uploads) {
            const file = shared.find((f) => assetPathFor(f.name) === upload.assetPath);
            assert(file, `unexpected presigned asset ${upload.assetPath}`);
            const putRes = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file.body });
            assert.strictEqual(putRes.status, 200, `PUT ${upload.assetPath} failed: ${await putRes.text()}`);
        }

        const posters = [
            { title: "Robotics", subtitle: "Automation", accent: "#2563eb" },
            { title: "Biotech", subtitle: "Sequencing", accent: "#dc2626" },
        ];
        const documents = posters.map((poster, i) => ({
            documentId: `${cacheId}-${i}`,
            mainTypAssetPath: assetPathFor("template.typ"),
            data: Buffer.from(JSON.stringify(poster), "utf-8").toString("base64"),
            dataFile: "poster.json",
            assets: [{ name: "background.png", assetPath: assetPathFor("background.png") }],
            storeToS3: true,
        }));

        // The whole point of the cache: the request carries no image bytes.
        const bodyBytes = JSON.stringify({ documents }).length;
        assert(bodyBytes < 2000, `expected a tiny request body, got ${bodyBytes} bytes`);

        const enqueueRes = await call({ action: "batch", storeToS3: true, documents });
        assert.strictEqual(enqueueRes.statusCode, 200, enqueueRes.body);
        const { batchId } = JSON.parse(enqueueRes.body);

        const messages = await drainQueue();
        assert.strictEqual(messages.length, 2, `expected 2 enqueued messages, got ${messages.length}`);
        const sqsRes = await call({ action: "sqs", records: messages.map((m) => ({ body: m.body })) });
        assert.strictEqual(sqsRes.statusCode, 200, sqsRes.body);
        for (const m of messages) {
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.receiptHandle }));
        }

        const statusRes = await call({ action: "batchstatus", batchId });
        const { results } = JSON.parse(statusRes.body);
        assert.strictEqual(results.length, 2, statusRes.body);
        for (const r of results) {
            assert.strictEqual(r.status, "completed", `document ${r.documentId}: ${r.error}`);
        }

        // Same template, same background, different bytes out — proof the
        // per-document data was bound rather than ignored.
        const outputs: string[] = [];
        for (const doc of documents) {
            const one = JSON.parse((await call({ action: "status", documentId: doc.documentId })).body);
            assert(one.s3_key, `document ${doc.documentId} has no output key`);
            const { Body } = await s3.send(new GetObjectCommand({ Bucket: OUTPUT_BUCKET, Key: one.s3_key }));
            const chunks: Uint8Array[] = [];
            for await (const chunk of Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
            outputs.push(Buffer.concat(chunks).toString("base64"));
        }
        assert.notStrictEqual(outputs[0], outputs[1], "documents sharing a template rendered identical output");

        // Evicting a cached asset must fail the enqueue, not N compiles later.
        const evictRes = await call({ action: "deleteasset", assetPath: assetPathFor("background.png") });
        assert.strictEqual(evictRes.statusCode, 200, evictRes.body);
        const afterEvict = await call({ action: "batch", storeToS3: true, documents });
        assert.strictEqual(afterEvict.statusCode, 400, afterEvict.body);
        assert(
            JSON.parse(afterEvict.body).error?.includes(`assets/${assetPathFor("background.png")}`),
            afterEvict.body
        );

        await call({ action: "deleteasset", assetPath: assetPathFor("template.typ") });
    });

    it("records a clear failure when an upload is deleted between enqueue and compile", async () => {
        if (skip()) return;
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
        const documentId = `presign-async-vanished-${Date.now()}`;

        // Simulates the lifecycle rule expiring an upload after the batch was
        // accepted: the worker sees the message, the object is gone. The message
        // is consumed rather than retried — a missing S3 object will not appear
        // on a redelivery — and the document is marked failed with the reason.
        const message = JSON.stringify({
            action: "compile",
            documentId,
            batchId: `batch-${documentId}`,
            mainTypUploadRef: { jobId: "vanished-job", name: "main.typ" },
            storeToS3: true,
        });
        const sqsRes = await call({ action: "sqs", records: [{ body: message }] });
        assert.strictEqual(sqsRes.statusCode, 200, sqsRes.body);

        const statusRes = await call({ action: "status", documentId });
        assert.strictEqual(statusRes.statusCode, 200, statusRes.body);
        const status = JSON.parse(statusRes.body);
        assert.strictEqual(status.status, "failed");
        assert(status.error?.includes("not found"), status.error);
    });
});
