/**
 * Lambda handler for Typst Serverless.
 * Actions: compile, status, retrieve, batch
 */
import { compile } from "../../core/compile.js";
import { createDynamoDBState, createInMemoryState } from "../../core/state.js";
import {
    validatePayloadSize,
    validateCompileEvent,
    validateStatusEvent,
    validateS3Key,
    validateWebhookUrl,
    validateBatchEvent,
    validateDocumentId,
    validateDataJson,
} from "../../core/validate.js";
import { validateAssets } from "../../core/assets.js";
import { resolveMainTyp } from "./resolve-input.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { rmSync } from "node:fs";
import https from "node:https";
import http from "node:http";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TYPST_PATH = process.env.TYPST_PATH || "/opt/bin/typst";
const STATE_TABLE = process.env.TYPST_STATE_TABLE || "typst-documents";
const OUTPUT_BUCKET = process.env.TYPST_OUTPUT_BUCKET;
const PRESIGNED_EXPIRY = parseInt(process.env.TYPST_PRESIGNED_EXPIRY || "3600", 10);

const endpoint = process.env.TYPST_AWS_ENDPOINT || process.env.AWS_ENDPOINT_URL;
const region = process.env.AWS_REGION || "us-east-1";
const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient(
        endpoint ? { endpoint, region, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {}
    )
);
const s3 = new S3Client(
    endpoint
        ? { endpoint, region, credentials: { accessKeyId: "test", secretAccessKey: "test" }, forcePathStyle: true }
        : {}
);

const sqs = new SQSClient(
    endpoint
        ? { endpoint, region, credentials: { accessKeyId: "test", secretAccessKey: "test" } }
        : {}
);

const BATCH_QUEUE_URL = process.env.TYPST_BATCH_QUEUE_URL;

const USE_IN_MEMORY_STATE = process.env.TYPST_USE_IN_MEMORY_STATE === "true" || process.env.TYPST_USE_IN_MEMORY_STATE === "1";
const inMemoryState = USE_IN_MEMORY_STATE ? createInMemoryState() : null;

function getState() {
    if (inMemoryState) return inMemoryState;
    return createDynamoDBState({ tableName: STATE_TABLE, documentClient: dynamo });
}

function invokeWebhook(url: string, payload: object): void {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const opts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    };
    const req = (u.protocol === "https:" ? https : http).request(opts);
    req.on("error", (e: Error) => {
        if (!process.env.VITEST) console.error("Webhook error:", e.message);
    });
    req.write(data);
    req.end();
}

function lambdaResponse(statusCode: number, body: object | string, headers: Record<string, string> = {}) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

interface LambdaEvent {
  action?: string;
  Action?: string;
  invocationType?: string;
  async?: boolean;
  mainTyp?: string;
  mainTypS3?: { bucket: string; key: string };
  documentId?: string;
  batchId?: string;
  dataJson?: string | { bucket: string; key: string };
  fonts?: unknown[];
  assets?: unknown[];
  outputS3?: { bucket: string; keyPrefix?: string };
  webhook?: { url: string };
  storeToS3?: boolean;
  outputFormat?: string;
  format?: string;
  pdfStandard?: string;
  documents?: unknown[];
  [key: string]: unknown;
}

export async function handler(event: LambdaEvent, _context?: unknown): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}> {
    const action = (event.action || event.Action || "compile").toLowerCase();
    const asyncInvoke = event.invocationType === "Event" || event.async === true;

    const sizeCheck = validatePayloadSize(event, asyncInvoke);
    if (!sizeCheck.valid) {
        return lambdaResponse(413, { error: sizeCheck.error });
    }

    try {
        if (action === "sqs") return await handleSqs(event);
        if (action === "compile") return await handleCompile(event);
        if (action === "status") return await handleStatus(event);
        if (action === "retrieve") return await handleRetrieve(event);
        if (action === "batch") return await handleBatch(event);
        if (action === "batchstatus") return await handleBatchStatus(String(event.documentId || event.batchId || ""));
        return lambdaResponse(400, { error: `Unknown action: ${action}` });
    } catch (err) {
        if (!process.env.VITEST) console.error(err);
        return lambdaResponse(500, { error: (err as Error).message || "Internal error" });
    }
}

async function handleCompile(event: LambdaEvent) {
    const validation = validateCompileEvent(event);
    if (!validation.valid) {
        return lambdaResponse(400, { error: validation.error });
    }
    if (event.fonts?.length) {
        const fontsCheck = validateAssets(event.fonts as Array<{ name?: string; bucket?: string; key?: string; base64?: string }>, "font");
        if (!fontsCheck.valid) return lambdaResponse(400, { error: fontsCheck.error });
    }
    if (event.assets?.length) {
        const assetsCheck = validateAssets(event.assets as Array<{ name?: string; bucket?: string; key?: string; base64?: string }>, "image");
        if (!assetsCheck.valid) return lambdaResponse(400, { error: assetsCheck.error });
    }
    if (event.outputS3 && (!event.outputS3.bucket || typeof event.outputS3.bucket !== "string")) {
        return lambdaResponse(400, { error: "outputS3.bucket is required for customer S3" });
    }
    if (event.webhook?.url) {
        const wh = validateWebhookUrl(event.webhook.url);
        if (!wh.valid) return lambdaResponse(400, { error: wh.error });
    }
    if (event.dataJson !== undefined) {
        const dj = validateDataJson(event.dataJson);
        if (!dj.valid) return lambdaResponse(400, { error: dj.error });
    }

    const documentId = event.documentId || randomUUID();
    const outputS3 = event.outputS3 && typeof event.outputS3.bucket === "string" ? event.outputS3 : null;
    const storeToS3 = !!(event.storeToS3 && (OUTPUT_BUCKET || outputS3?.bucket));
    const state = getState();
    const batchId = typeof event.batchId === "string" ? event.batchId : undefined;

    let workDir: string | undefined;
    try {
        await state.set(documentId, {
            status: "pending",
            createdAt: Date.now(),
            ...(batchId && { batch_id: batchId }),
        });
        await state.update(documentId, { status: "compiling" });

        const { workDir: wd, mainPath } = await resolveMainTyp(event, s3);
        workDir = wd;
        const format = (event.outputFormat || event.format || "pdf").toLowerCase();
        const ext = ["pdf", "svg", "png"].includes(format) ? format : "pdf";
        const outputPath = join(workDir, `output.${ext}`);
        const compileOpts: { typstPath: string; format: string; pdfStandard?: string } = {
            typstPath: TYPST_PATH,
            format: ext,
        };
        if (event.pdfStandard) compileOpts.pdfStandard = String(event.pdfStandard).toLowerCase();
        await compile(mainPath, outputPath, compileOpts);

        if (storeToS3) {
            const fs = await import("node:fs/promises");
            const outBuffer = await fs.readFile(outputPath);
            const bucket = outputS3?.bucket ?? OUTPUT_BUCKET;
            if (!bucket) throw new Error("Output bucket not configured (TYPST_OUTPUT_BUCKET or outputS3.bucket)");
            const keyPrefix = (outputS3?.keyPrefix || "outputs/").replace(/\/?$/, "/");
            const s3Key = `${keyPrefix}${documentId}.${ext}`;
            const keyCheck = validateS3Key(s3Key);
            if (!keyCheck.valid) {
                throw new Error(keyCheck.error);
            }
            const contentType = ext === "pdf" ? "application/pdf" : ext === "svg" ? "image/svg+xml" : "image/png";
            await s3.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: s3Key,
                    Body: outBuffer,
                    ContentType: contentType,
                })
            );
            await state.update(documentId, { status: "completed", s3_key: s3Key, s3_bucket: bucket });
            const url = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
                { expiresIn: PRESIGNED_EXPIRY }
            );
            if (event.webhook?.url) {
                invokeWebhook(event.webhook.url, { documentId, status: "completed", s3Url: url });
            }
            return lambdaResponse(200, { documentId, status: "completed", s3Url: url });
        }

        const fs = await import("node:fs/promises");
        const outBuffer = await fs.readFile(outputPath);
        await state.update(documentId, { status: "completed" });
        if (event.webhook?.url) {
            invokeWebhook(event.webhook.url, {
                documentId,
                status: "completed",
                pdf: outBuffer.toString("base64"),
                format: ext,
            });
        }
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                documentId,
                status: "completed",
                pdf: outBuffer.toString("base64"),
                format: ext,
            }),
            isBase64Encoded: false,
        };
    } catch (err) {
        try {
            await state.update(documentId, { status: "failed", error: (err as Error).message });
        } catch {}
        if (event.webhook?.url) {
            invokeWebhook(event.webhook.url, { documentId, status: "failed", error: (err as Error).message });
        }
        return lambdaResponse(500, {
            error: (err as Error).message,
            documentId,
            status: "failed",
        });
    } finally {
        if (workDir) {
            try {
                rmSync(workDir, { recursive: true, force: true });
            } catch {}
        }
    }
}

async function handleStatus(event: LambdaEvent) {
    const validation = validateStatusEvent(event);
    if (!validation.valid) {
        return lambdaResponse(400, { error: validation.error });
    }
    const docId = event.documentId;
    if (typeof docId !== "string") {
        return lambdaResponse(400, { error: "documentId required" });
    }
    const state = getState();
    const doc = await state.get(docId);
    if (!doc) {
        return lambdaResponse(404, { error: "Document not found" });
    }
    return lambdaResponse(200, {
        documentId: docId,
        status: doc.status,
        s3_key: doc.s3_key,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        error: doc.error,
    });
}

async function handleRetrieve(event: LambdaEvent) {
    const validation = validateStatusEvent(event);
    if (!validation.valid) {
        return lambdaResponse(400, { error: validation.error });
    }
    const docId = event.documentId;
    if (typeof docId !== "string") {
        return lambdaResponse(400, { error: "documentId required" });
    }
    const state = getState();
    const doc = await state.get(docId);
    if (!doc) {
        return lambdaResponse(404, { error: "Document not found" });
    }
    if (doc.status !== "completed") {
        return lambdaResponse(409, { error: `Document status: ${doc.status}`, status: doc.status });
    }
    if (doc.s3_key) {
        const bucket = doc.s3_bucket || OUTPUT_BUCKET;
        if (!bucket) {
            return lambdaResponse(500, { error: "Output bucket not configured" });
        }
        const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: bucket, Key: doc.s3_key }),
            { expiresIn: PRESIGNED_EXPIRY }
        );
        return lambdaResponse(200, { s3Url: url });
    }
    return lambdaResponse(400, {
        error: "PDF not stored in S3; use compile with storeToS3 for retrieval by ID",
    });
}

function batchEnabled(): boolean {
    return !!(BATCH_QUEUE_URL && OUTPUT_BUCKET);
}

async function handleBatchEnqueue(event: LambdaEvent) {
    const validation = validateBatchEvent(event);
    if (!validation.valid) {
        return lambdaResponse(400, { error: validation.error });
    }
    if (!BATCH_QUEUE_URL) {
        return lambdaResponse(503, { error: "Batch queue not configured" });
    }
    const outputS3 = event.outputS3 && typeof event.outputS3.bucket === "string" ? event.outputS3 : null;
    const storeToS3 = !!(event.storeToS3 && (OUTPUT_BUCKET || outputS3?.bucket));
    if (!storeToS3) {
        return lambdaResponse(400, { error: "Batch requires S3 storage (storeToS3: true)" });
    }

    const batchId = randomUUID();
    const documentIds: string[] = [];

    for (const doc of event.documents || []) {
        const d = doc as Record<string, unknown>;
        const documentId = (d.documentId as string) || randomUUID();
        documentIds.push(documentId);
        const message = JSON.stringify({
            action: "compile",
            ...d,
            documentId,
            batchId,
            storeToS3: true,
        });
        await sqs.send(
            new SendMessageCommand({
                QueueUrl: BATCH_QUEUE_URL,
                MessageBody: message,
            })
        );
    }

    return lambdaResponse(200, { batchId, documentIds });
}

async function handleBatchStatus(batchId: string) {
    if (!batchId) {
        return lambdaResponse(400, { error: "batchId required" });
    }
    const idCheck = validateDocumentId(batchId);
    if (!idCheck.valid) {
        return lambdaResponse(400, { error: idCheck.error });
    }
    if (USE_IN_MEMORY_STATE) {
        return lambdaResponse(400, { error: "Batch status not available in sync/in-memory mode" });
    }

    const { Items } = await dynamo.send(
        new QueryCommand({
            TableName: STATE_TABLE,
            IndexName: "batch_id-index",
            KeyConditionExpression: "batch_id = :bid",
            ExpressionAttributeValues: { ":bid": batchId },
        })
    );

    const results = (Items || []).map((item) => {
        const r: { documentId: string; status: string; s3Url?: string; error?: string } = {
            documentId: item.document_id,
            status: item.status,
        };
        if (item.status === "completed" && item.s3_key) {
            const bucket = item.s3_bucket || OUTPUT_BUCKET;
            if (bucket) {
                getSignedUrl(
                    s3,
                    new GetObjectCommand({ Bucket: bucket, Key: item.s3_key }),
                    { expiresIn: PRESIGNED_EXPIRY }
                ).then((url) => {
                    r.s3Url = url;
                });
            }
        }
        if (item.error) r.error = item.error;
        return r;
    });

    // Resolve presigned URLs (they're async)
    const resolved = await Promise.all(
        results.map(async (r) => {
            if (r.status === "completed") {
                const item = (Items || []).find((i) => i.document_id === r.documentId);
                if (item?.s3_key) {
                    const bucket = item.s3_bucket || OUTPUT_BUCKET;
                    if (bucket) {
                        r.s3Url = await getSignedUrl(
                            s3,
                            new GetObjectCommand({ Bucket: bucket, Key: item.s3_key }),
                            { expiresIn: PRESIGNED_EXPIRY }
                        );
                    }
                }
            }
            return r;
        })
    );

    return lambdaResponse(200, { batchId, results: resolved });
}

async function handleSqs(event: LambdaEvent) {
    const records = event.records as { body: string }[] | undefined;
    if (!Array.isArray(records)) {
        return lambdaResponse(400, { error: "Invalid SQS event" });
    }
    for (const rec of records) {
        try {
            const payload = JSON.parse(rec.body) as LambdaEvent;
            await handleCompile({ ...payload, action: "compile" });
        } catch (err) {
            if (!process.env.VITEST) console.error("SQS message processing failed:", err);
            throw err;
        }
    }
    return lambdaResponse(200, { processed: records.length });
}

async function handleBatch(event: LambdaEvent) {
    const validation = validateBatchEvent(event);
    if (!validation.valid) {
        return lambdaResponse(400, { error: validation.error });
    }
    if (batchEnabled()) {
        return handleBatchEnqueue(event);
    }
    const results: Array<{ documentId?: string; status: string; error?: string; s3Url?: string; pdf?: string }> = [];
    for (const doc of event.documents || []) {
        const subEvent = { ...(doc as LambdaEvent), action: "compile" };
        const res = await handler(subEvent, {});
        const body = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
        results.push({
            documentId: body.documentId,
            status: body.status || (res.statusCode >= 400 ? "failed" : "completed"),
            error: body.error,
            s3Url: body.s3Url,
            ...(body.pdf && { pdf: body.pdf }),
        });
    }
    return lambdaResponse(200, { results });
}
