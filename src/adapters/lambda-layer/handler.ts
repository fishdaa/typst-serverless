/**
 * Lambda handler for Typst Serverless.
 * Actions: compile, status, retrieve, batch, uploadasset, listassets, presigndownloadasset, deleteasset
 */
import { compile } from "@/core/compile.js";
import { createInMemoryState } from "@/core/state.js";
import { createDynamoDBState } from "@/core/state-dynamodb.js";
import {
    validatePayloadSize,
    validateCompileEvent,
    validateStatusEvent,
    validateS3Key,
    validateWebhookUrl,
    validateBatchEvent,
    validateDocumentId,
    validateData,
    validateAssetPath,
    validateS3Ref,
} from "@/core/validate.js";
import { validateAssets } from "@/core/assets.js";
import { resolveMainTyp, ASSET_PREFIX } from "@/adapters/lambda-layer/resolve-input.js";
import { StepLog, pollChildRss, dirSizeMB } from "@/adapters/lambda-layer/telemetry.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
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
const ASSETS_BUCKET = process.env.TYPST_ASSETS_BUCKET || process.env.TYPST_INPUT_BUCKET;
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

type DynamoBatchItem = {
    document_id: string;
    status: string;
    s3_key?: string;
    s3_bucket?: string;
    error?: string;
    updatedAt?: number;
};
type BatchStatusResult = { documentId: string; status: string; s3Url?: string; error?: string };

// Lambda is configured for 90 seconds. Add a small buffer so a hard timeout is
// reconciled by the next status poll instead of leaving the job at "compiling".
const STALE_COMPILE_MS = 130_000;
const TIMEOUT_ERROR = "Compilation timed out after 120 seconds; the Lambda worker was terminated.";

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
  mainTypAssetPath?: string;
  main?: string;
  /** Cache-asset upload/list/delete fields (uploadasset/deleteasset actions) */
  assetPath?: string;
  base64?: string;
  bucket?: string;
  key?: string;
  contentType?: string;
  /** Optional extra .typ sources for #include / modules: { name, base64? } or { name, bucket, key } */
  extraTyps?: Array<{ name: string; base64?: string; bucket?: string; key?: string }>;
  documentId?: string;
  batchId?: string;
  data?: string | { bucket: string; key: string };
  dataFile?: string;
  fonts?: unknown[];
  assets?: unknown[];
  outputS3?: { bucket: string; keyPrefix?: string };
  outputKey?: string;
  webhook?: { url: string };
  storeToS3?: boolean;
  outputFormat?: string;
  format?: string;
  pdfStandard?: string;
  /** Pixels per inch for PNG export (large-format posters etc). */
  ppi?: number;
  /** Caps peak memory used while rendering a page to PNG, in mebibytes. */
  maxMemory?: number;
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
        if (action === "uploadasset") return await handleUploadAsset(event);
        if (action === "presignuploadasset") return await handlePresignUploadAsset(event);
        if (action === "presigndownloadasset") return await handlePresignDownloadAsset(event);
        if (action === "listassets") return await handleListAssets(event);
        if (action === "deleteasset") return await handleDeleteAsset(event);
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
    if (event.outputKey !== undefined) {
        const keyCheck = validateS3Key(event.outputKey);
        if (!keyCheck.valid) return lambdaResponse(400, { error: keyCheck.error });
    }
    if (event.webhook?.url) {
        const wh = validateWebhookUrl(event.webhook.url);
        if (!wh.valid) return lambdaResponse(400, { error: wh.error });
    }
    if (event.data !== undefined) {
        const dataCheck = validateData(event.data, event.dataFile);
        if (!dataCheck.valid) return lambdaResponse(400, { error: dataCheck.error });
    }

    const documentId = event.documentId || randomUUID();
    const outputS3 = event.outputS3 && typeof event.outputS3.bucket === "string" ? event.outputS3 : null;
    const storeToS3 = !!(event.storeToS3 && (OUTPUT_BUCKET || outputS3?.bucket));
    const state = getState();
    const batchId = typeof event.batchId === "string" ? event.batchId : undefined;
    const log = new StepLog({ documentId, batchId, action: "compile" });
    log.emit("start", {
        outputFormat: event.outputFormat || event.format,
        ppi: event.ppi,
        maxMemory: event.maxMemory,
        storeToS3,
        assetsCount: event.assets?.length ?? 0,
        fontsCount: event.fonts?.length ?? 0,
        extraTypsCount: event.extraTyps?.length ?? 0,
        hasData: event.data !== undefined,
    });

    let workDir: string | undefined;
    try {
        await state.set(documentId, {
            status: "pending",
            createdAt: Date.now(),
            ...(batchId && { batch_id: batchId }),
        });
        await state.update(documentId, { status: "compiling" });
        log.emit("state-compiling");

        const { workDir: wd, mainPath } = await resolveMainTyp(event, s3, ASSETS_BUCKET);
        workDir = wd;
        log.emit("resolve-input", { inputMB: await dirSizeMB(workDir) });
        const format = (event.outputFormat || event.format || "pdf").toLowerCase();
        const ext = ["pdf", "svg", "png"].includes(format) ? format : "pdf";
        const outputPath = join(workDir, `output.${ext}`);
        const compileOpts: { typstPath: string; format: string; pdfStandard?: string; ppi?: number; maxMemory?: number } = {
            typstPath: TYPST_PATH,
            format: ext,
        };
        if (event.pdfStandard) compileOpts.pdfStandard = String(event.pdfStandard).toLowerCase();
        if (ext === "png" && event.ppi !== undefined) {
            const ppi = Number(event.ppi);
            if (!Number.isFinite(ppi) || ppi <= 0 || ppi > 10000) {
                return lambdaResponse(400, { error: "ppi must be a positive number (<= 10000)" });
            }
            compileOpts.ppi = ppi;
        }
        if (ext === "png" && event.maxMemory !== undefined) {
            const maxMemory = Number(event.maxMemory);
            if (!Number.isFinite(maxMemory) || maxMemory <= 0) {
                return lambdaResponse(400, { error: "maxMemory must be a positive number (mebibytes)" });
            }
            compileOpts.maxMemory = maxMemory;
        }
        let rssPoll: { stop(): number } | undefined;
        await compile(mainPath, outputPath, {
            ...compileOpts,
            onSpawn: (pid) => {
                rssPoll = pollChildRss(pid);
            },
        });
        const typstPeakRssMB = rssPoll?.stop();
        log.emit("compile", { typstPeakRssMB });

        if (storeToS3) {
            const fs = await import("node:fs/promises");
            const { size: outputBytes } = await fs.stat(outputPath);
            log.emit("read-output", { outputMB: Math.round((outputBytes / 1024 / 1024) * 10) / 10 });
            const bucket = outputS3?.bucket ?? OUTPUT_BUCKET;
            if (!bucket) throw new Error("Output bucket not configured (TYPST_OUTPUT_BUCKET or outputS3.bucket)");
            const keyPrefix = (outputS3?.keyPrefix || "outputs/").replace(/\/?$/, "/");
            const s3Key = typeof event.outputKey === "string" && event.outputKey.length > 0
                ? event.outputKey
                : `${keyPrefix}${documentId}.${ext}`;
            const keyCheck = validateS3Key(s3Key);
            if (!keyCheck.valid) {
                throw new Error(keyCheck.error);
            }
            const contentType = ext === "pdf" ? "application/pdf" : ext === "svg" ? "image/svg+xml" : "image/png";
            const { createReadStream } = await import("node:fs");
            // Streams the output file straight to S3 (multipart for large files) instead of
            // buffering the whole thing in Node memory — outputs of hundreds of MB to low GB
            // (e.g. large-format posters) would otherwise risk OOMing the Lambda container even
            // though the typst renderer itself stays well under its --max-memory band budget.
            const upload = new Upload({
                client: s3,
                params: {
                    Bucket: bucket,
                    Key: s3Key,
                    Body: createReadStream(outputPath),
                    ContentType: contentType,
                },
            });
            await upload.done();
            log.emit("s3-upload", { bucket, key: s3Key });
            await state.update(documentId, { status: "completed", s3_key: s3Key, s3_bucket: bucket });
            const url = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
                { expiresIn: PRESIGNED_EXPIRY }
            );
            if (event.webhook?.url) {
                invokeWebhook(event.webhook.url, { documentId, status: "completed", s3Url: url });
            }
            log.emit("done", { status: "completed" });
            return lambdaResponse(200, { documentId, status: "completed", s3Url: url });
        }

        const fs = await import("node:fs/promises");
        const outBuffer = await fs.readFile(outputPath);
        await state.update(documentId, { status: "completed" });
        log.emit("done", { status: "completed", outputMB: Math.round((outBuffer.length / 1024 / 1024) * 10) / 10 });
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
        log.emit("failed", { error: (err as Error).message });
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
    const out: Record<string, unknown> = {
        documentId: docId,
        status: doc.status,
        s3_key: doc.s3_key,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        error: doc.error,
    };
    if (doc.status === "completed" && doc.s3_key) {
        const bucket = doc.s3_bucket || OUTPUT_BUCKET;
        if (bucket) {
            out.s3Url = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: doc.s3_key }),
                { expiresIn: PRESIGNED_EXPIRY }
            );
        }
    }
    return lambdaResponse(200, out);
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

    const results = ((Items || []) as DynamoBatchItem[]).map((item) => {
        const r: BatchStatusResult = {
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
                ).then((url: string) => {
                    r.s3Url = url;
                });
            }
        }
        if (item.error) r.error = item.error;
        return r;
    });

    // Resolve presigned URLs (they're async)
    const resolved = await Promise.all(
        results.map(async (r: BatchStatusResult) => {
            const item = ((Items || []) as DynamoBatchItem[]).find((i) => i.document_id === r.documentId);
            if (item && await reconcileStaleCompile(item)) {
                r.status = "failed";
                r.error = TIMEOUT_ERROR;
                return r;
            }
            if (r.status === "completed") {
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

/** Mark jobs killed by Lambda's hard timeout as failed, with a race-safe update. */
async function reconcileStaleCompile(item: DynamoBatchItem): Promise<boolean> {
    if (item.status !== "compiling" || !item.updatedAt || Date.now() - item.updatedAt < STALE_COMPILE_MS) {
        return false;
    }
    try {
        await dynamo.send(new UpdateCommand({
            TableName: STATE_TABLE,
            Key: { document_id: item.document_id },
            UpdateExpression: "SET #status = :failed, #error = :error, #updatedAt = :now",
            ConditionExpression: "#status = :compiling AND #updatedAt = :observed",
            ExpressionAttributeNames: { "#status": "status", "#error": "error", "#updatedAt": "updatedAt" },
            ExpressionAttributeValues: {
                ":failed": "failed",
                ":compiling": "compiling",
                ":error": TIMEOUT_ERROR,
                ":observed": item.updatedAt,
                ":now": Date.now(),
            },
        }));
        return true;
    } catch (err) {
        if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw err;
    }
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

function assetKeyFor(assetPath: string): string {
    return `${ASSET_PREFIX}${assetPath}`;
}

/**
 * Upload (or register) a reusable asset, cached in S3 under a stable path.
 * Provide either `base64` (uploads fresh bytes) or `bucket`+`key` (registers an
 * existing S3 object under the assetPath without copying it).
 */
async function handleUploadAsset(event: LambdaEvent) {
    const pathCheck = validateAssetPath(event.assetPath);
    if (!pathCheck.valid) return lambdaResponse(400, { error: pathCheck.error });
    const assetPath = event.assetPath as string;

    const hasBase64 = typeof event.base64 === "string" && event.base64.length > 0;
    const hasS3Ref = event.bucket != null && event.key != null;
    if (!hasBase64 && !hasS3Ref) {
        return lambdaResponse(400, { error: "Provide base64 or bucket+key" });
    }
    if (hasBase64 && hasS3Ref) {
        return lambdaResponse(400, { error: "Provide base64 or bucket+key, not both" });
    }

    if (hasS3Ref) {
        const refCheck = validateS3Ref({ bucket: event.bucket, key: event.key });
        if (!refCheck.valid) return lambdaResponse(400, { error: refCheck.error });
        // Register-in-place: copy the referenced object into the assets bucket so
        // listing/deleting/resolving by assetPath stays consistent regardless of source.
        if (!ASSETS_BUCKET) {
            return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
        }
        await s3.send(
            new CopyObjectCommand({
                Bucket: ASSETS_BUCKET,
                Key: assetKeyFor(assetPath),
                CopySource: `${event.bucket}/${encodeURIComponent(event.key as string)}`,
                ...(event.contentType && { ContentType: event.contentType, MetadataDirective: "REPLACE" }),
            })
        );
        return lambdaResponse(200, { assetPath });
    }

    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const buffer = Buffer.from(event.base64 as string, "base64");
    await s3.send(
        new PutObjectCommand({
            Bucket: ASSETS_BUCKET,
            Key: assetKeyFor(assetPath),
            Body: buffer,
            ...(event.contentType && { ContentType: event.contentType }),
        })
    );
    return lambdaResponse(200, { assetPath, size: buffer.length });
}

/**
 * Presign a direct-to-S3 PUT URL for a cached asset, so large files (e.g.
 * print-resolution poster backgrounds) can bypass the API Gateway/Lambda
 * payload limit entirely instead of being base64-embedded in the request body.
 */
async function handlePresignUploadAsset(event: LambdaEvent) {
    const pathCheck = validateAssetPath(event.assetPath);
    if (!pathCheck.valid) return lambdaResponse(400, { error: pathCheck.error });
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const assetPath = event.assetPath as string;
    const contentType = typeof event.contentType === "string" ? event.contentType : undefined;
    const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: ASSETS_BUCKET,
            Key: assetKeyFor(assetPath),
            ...(contentType && { ContentType: contentType }),
        }),
        { expiresIn: PRESIGNED_EXPIRY }
    );
    return lambdaResponse(200, { assetPath, uploadUrl, contentType });
}

/** Presign a private cached asset for browser download. */
async function handlePresignDownloadAsset(event: LambdaEvent) {
    const pathCheck = validateAssetPath(event.assetPath);
    if (!pathCheck.valid) return lambdaResponse(400, { error: pathCheck.error });
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const assetPath = event.assetPath as string;
    const filename = assetPath.split("/").pop() || "asset";
    const downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: ASSETS_BUCKET,
            Key: assetKeyFor(assetPath),
            ResponseContentDisposition: `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        }),
        { expiresIn: PRESIGNED_EXPIRY }
    );
    return lambdaResponse(200, { assetPath, downloadUrl });
}

/** List cached assets under an optional path prefix. */
async function handleListAssets(event: LambdaEvent) {
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const prefix = typeof event.prefix === "string" && event.prefix.length > 0
        ? `${ASSET_PREFIX}${event.prefix}`
        : ASSET_PREFIX;
    const { Contents } = await s3.send(
        new ListObjectsV2Command({ Bucket: ASSETS_BUCKET, Prefix: prefix })
    );
    const assets = (Contents || []).map((obj) => ({
        assetPath: (obj.Key || "").slice(ASSET_PREFIX.length),
        size: obj.Size,
        lastModified: obj.LastModified,
    }));
    return lambdaResponse(200, { assets });
}

/** Delete a cached asset by path. */
async function handleDeleteAsset(event: LambdaEvent) {
    const pathCheck = validateAssetPath(event.assetPath);
    if (!pathCheck.valid) return lambdaResponse(400, { error: pathCheck.error });
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: ASSETS_BUCKET, Key: assetKeyFor(event.assetPath as string) }));
    return lambdaResponse(200, { assetPath: event.assetPath, deleted: true });
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
