/**
 * Lambda handler for Typst Serverless.
 * Actions: compile, status, retrieve, batch, uploadasset, presignuploadasset,
 * presignuploads, listassets, presigndownloadasset, deleteasset
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
import {
    validateUploadRequest,
    validateUploadRequests,
    validateJobId,
    maxUploadBytes,
} from "@/core/uploads.js";
import {
    resolveMainTyp,
    resolveContentSource,
    assetKeyFor,
    uploadKeyFor,
    MissingInputError,
    ASSET_PREFIX,
    type UploadRef,
} from "@/adapters/lambda-layer/resolve-input.js";
import { StepLog, pollChildRss, dirSizeMB } from "@/adapters/lambda-layer/telemetry.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand } from "@aws-sdk/client-s3";
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
const s3Config = endpoint
    ? { endpoint, region, credentials: { accessKeyId: "test", secretAccessKey: "test" }, forcePathStyle: true }
    : {};
const s3 = new S3Client(s3Config);

// Separate client for signing upload URLs. By default the SDK adds a flexible
// checksum header (x-amz-checksum-crc32) to PutObject and signs it in, which a
// plain browser `fetch(url, { method: "PUT", body: blob })` cannot satisfy — S3
// then rejects the upload. "WHEN_REQUIRED" keeps checksums on our own server-side
// uploads (which use the client above) while leaving presigned PUTs signable by
// a client that only sends Content-Type and Content-Length.
const s3Presigner = new S3Client({ ...s3Config, requestChecksumCalculation: "WHEN_REQUIRED" });

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
const STALE_COMPILE_MS = 100_000;
const TIMEOUT_ERROR = "Compilation timed out after 90 seconds; the Lambda worker was terminated.";

const sqs = new SQSClient(
    endpoint
        ? { endpoint, region, credentials: { accessKeyId: "test", secretAccessKey: "test" } }
        : {}
);

const BATCH_QUEUE_URL = process.env.TYPST_BATCH_QUEUE_URL;

const USE_IN_MEMORY_STATE = process.env.TYPST_USE_IN_MEMORY_STATE === "true" || process.env.TYPST_USE_IN_MEMORY_STATE === "1";
const inMemoryState = USE_IN_MEMORY_STATE ? createInMemoryState() : null;

function outputFilename(key: string): string {
    const name = key.split("/").pop() || "typst-output";
    return name.replace(/[\r\n"]/g, "_");
}

function presignOutput(bucket: string, key: string): Promise<string> {
    return getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseContentDisposition: `attachment; filename="${outputFilename(key)}"`,
        }),
        { expiresIn: PRESIGNED_EXPIRY },
    );
}

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
  /** Reference to an ephemeral presigned upload: { jobId, name }. */
  mainTypUploadRef?: UploadRef;
  main?: string;
  /** Cache-asset upload/list/delete fields (uploadasset/deleteasset actions) */
  assetPath?: string;
  base64?: string;
  bucket?: string;
  key?: string;
  contentType?: string;
  /** Presign fields: exact byte length and list form (presignuploadasset/presignuploads). */
  sizeBytes?: number;
  assets?: unknown[];
  files?: unknown[];
  jobId?: string;
  /** Optional extra .typ sources for #include / modules: { name, base64? } or { name, bucket, key } */
  extraTyps?: Array<{ name: string; base64?: string; bucket?: string; key?: string; assetPath?: string; uploadRef?: UploadRef }>;
  documentId?: string;
  batchId?: string;
  data?: string | { bucket: string; key: string } | { assetPath: string } | { uploadRef: UploadRef };
  dataFile?: string;
  fonts?: unknown[];
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
  /** PNG compression effort: no-compression, fastest, fast, balanced, or high. */
  pngCompression?: string;
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
        if (action === "presignuploads") return await handlePresignUploads(event);
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
        pngCompression: event.pngCompression,
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

        // Fail fast (and with an actionable message) when a presigned upload the
        // event references never landed, instead of dying inside resolution.
        await verifyAssetsBucketRefs(event);

        const { workDir: wd, mainPath } = await resolveMainTyp(event, s3, ASSETS_BUCKET);
        workDir = wd;
        log.emit("resolve-input", { inputMB: await dirSizeMB(workDir) });
        const format = (event.outputFormat || event.format || "pdf").toLowerCase();
        const ext = ["pdf", "svg", "png"].includes(format) ? format : "pdf";
        const outputPath = join(workDir, `output.${ext}`);
        const compileOpts: { typstPath: string; format: string; pdfStandard?: string; ppi?: number; maxMemory?: number; pngCompression?: string } = {
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
        if (ext === "png" && event.pngCompression !== undefined) {
            const pngCompression = String(event.pngCompression).toLowerCase();
            if (!["no-compression", "fastest", "fast", "balanced", "high"].includes(pngCompression)) {
                return lambdaResponse(400, { error: "pngCompression must be one of no-compression, fastest, fast, balanced, or high" });
            }
            compileOpts.pngCompression = pngCompression;
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
            const url = await presignOutput(bucket, s3Key);
            if (event.webhook?.url) {
                invokeWebhook(event.webhook.url, { documentId, status: "completed", s3Url: url });
            }
            log.emit("done", { status: "completed" });
            return lambdaResponse(200, { documentId, status: "completed", s3Url: url, sizeBytes: outputBytes });
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
                sizeBytes: outBuffer.length,
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
        // A missing input is the caller's mistake (upload never completed, or the
        // ephemeral upload already expired), not a server fault.
        const statusCode = err instanceof MissingInputError ? 400 : 500;
        return lambdaResponse(statusCode, {
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
            out.s3Url = await presignOutput(bucket, doc.s3_key);
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
        const url = await presignOutput(bucket, doc.s3_key);
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

    // Verify every document's presigned inputs before enqueueing any of them, so
    // a missing upload is a 400 on the enqueue call rather than N failures
    // discovered later through status polling.
    try {
        // Batches typically share inputs (one background per poster, one logo for
        // all of them), so verify the union of keys rather than per document.
        const keys = (event.documents || []).flatMap((doc) => collectAssetsBucketKeys(doc as LambdaEvent));
        await verifyKeys([...new Set(keys)]);
    } catch (err) {
        if (err instanceof MissingInputError) {
            return lambdaResponse(400, { error: err.message });
        }
        throw err;
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
                presignOutput(bucket, item.s3_key).then((url: string) => {
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
                        r.s3Url = await presignOutput(bucket, item.s3_key);
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
 * Keys in the assets bucket that a compile event references indirectly, via
 * assetPath or uploadRef. Direct bucket+key refs are excluded: they may live in
 * a customer bucket where a HEAD is not necessarily permitted.
 */
function collectAssetsBucketKeys(event: LambdaEvent): string[] {
    if (!ASSETS_BUCKET) return [];
    const keys: string[] = [];
    const push = (ref: { assetPath?: string; uploadRef?: UploadRef }) => {
        if (!ref.assetPath && !ref.uploadRef) return;
        const src = resolveContentSource(ref, ASSETS_BUCKET);
        if (src.key) keys.push(src.key);
    };

    push({
        assetPath: event.mainTypAssetPath,
        uploadRef: event.mainTypUploadRef,
    });
    for (const group of [event.assets, event.fonts, event.extraTyps]) {
        for (const item of (group as Array<{ assetPath?: string; uploadRef?: UploadRef }> | undefined) || []) {
            if (item && typeof item === "object") push(item);
        }
    }
    if (event.data && typeof event.data === "object") {
        push(event.data as { assetPath?: string; uploadRef?: UploadRef });
    }
    return [...new Set(keys)];
}

/**
 * HEAD every indirectly-referenced input before compiling. Without this, a
 * presigned upload that never completed surfaces as a raw NoSuchKey deep inside
 * input resolution — a 500 for the sync caller, and for a batch, a per-document
 * failure discovered minutes later via status polling.
 */
async function verifyAssetsBucketRefs(event: LambdaEvent): Promise<void> {
    return verifyKeys(collectAssetsBucketKeys(event));
}

/** HEAD the given assets-bucket keys, throwing MissingInputError listing any absent. */
async function verifyKeys(keys: string[]): Promise<void> {
    if (keys.length === 0 || !ASSETS_BUCKET) return;
    const bucket = ASSETS_BUCKET;
    const results = await Promise.all(
        keys.map(async (key) => {
            try {
                await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                return null;
            } catch (err) {
                const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
                if (e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
                    return key;
                }
                throw err;
            }
        })
    );
    const missing = results.filter((k): k is string => k !== null);
    if (missing.length > 0) throw new MissingInputError(bucket, missing);
}

interface PresignedUpload {
    uploadUrl: string;
    contentType: string;
    sizeBytes: number;
    /** Headers the client must send on the PUT; both are signed into the URL. */
    headers: Record<string, string>;
}

/**
 * Sign one direct-to-S3 PUT. Content type and exact byte length are signed in,
 * so a leaked URL can only write that content type at that exact size — S3
 * rejects anything else. Clients must echo both back as request headers.
 */
async function presignPut(bucket: string, key: string, contentType: string, sizeBytes: number): Promise<PresignedUpload> {
    const uploadUrl = await getSignedUrl(
        s3Presigner,
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
            ContentLength: sizeBytes,
        }),
        { expiresIn: PRESIGNED_EXPIRY }
    );
    return {
        uploadUrl,
        contentType,
        sizeBytes,
        headers: { "Content-Type": contentType, "Content-Length": String(sizeBytes) },
    };
}

function presignExpiresAt(): string {
    return new Date(Date.now() + PRESIGNED_EXPIRY * 1000).toISOString();
}

/**
 * Presign direct-to-S3 PUT URLs for the persistent asset library, so large
 * files (e.g. print-resolution poster backgrounds) bypass the API
 * Gateway/Lambda payload limit instead of being base64-embedded in the body.
 *
 * Single form: `{ assetPath, contentType, sizeBytes }`.
 * Batch form:  `{ assets: [{ assetPath, contentType, sizeBytes }, ...] }`.
 *
 * Objects written here never expire — use `presignuploads` for one-off job
 * inputs that should not accumulate in the library.
 */
async function handlePresignUploadAsset(event: LambdaEvent) {
    const batch = Array.isArray(event.assets) ? event.assets : null;

    if (batch) {
        const check = validateUploadRequests(batch, "assetPath");
        if (!check.valid) return lambdaResponse(400, { error: check.error });
        if (!ASSETS_BUCKET) {
            return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
        }
        const bucket = ASSETS_BUCKET;
        const uploads = await Promise.all(
            (check.items || []).map(async (item) => ({
                assetPath: item.path,
                ...(await presignPut(bucket, assetKeyFor(item.path), item.contentType, item.sizeBytes)),
            }))
        );
        return lambdaResponse(200, { uploads, expiresAt: presignExpiresAt() });
    }

    const check = validateUploadRequest(
        { path: event.assetPath, contentType: event.contentType, sizeBytes: event.sizeBytes },
        "assetPath"
    );
    if (!check.valid) return lambdaResponse(400, { error: check.error });
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const assetPath = event.assetPath as string;
    const presigned = await presignPut(
        ASSETS_BUCKET,
        assetKeyFor(assetPath),
        event.contentType as string,
        Number(event.sizeBytes)
    );
    return lambdaResponse(200, { assetPath, ...presigned, expiresAt: presignExpiresAt() });
}

/**
 * Presign direct-to-S3 PUT URLs for ephemeral, job-scoped compile inputs under
 * uploads/<jobId>/. Same mechanism as the asset library, different lifecycle:
 * these keys are expired by an S3 lifecycle rule, so one-off inputs (a poster
 * background, a generated data file) do not pollute the curated library.
 *
 * Request:  `{ jobId?, files: [{ name, contentType, sizeBytes }, ...] }`
 * Response: `{ jobId, uploads: [{ name, uploadUrl, headers, ... }], expiresAt }`
 *
 * Pass the returned `jobId` to /compile or /batch as `{ uploadRef: { jobId, name } }`
 * on any input — the async path resolves it identically to the sync path.
 */
async function handlePresignUploads(event: LambdaEvent) {
    if (event.jobId !== undefined) {
        const jobCheck = validateJobId(event.jobId);
        if (!jobCheck.valid) return lambdaResponse(400, { error: jobCheck.error });
    }
    const check = validateUploadRequests(event.files, "name");
    if (!check.valid) return lambdaResponse(400, { error: check.error });
    if (!ASSETS_BUCKET) {
        return lambdaResponse(503, { error: "Assets bucket not configured (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)" });
    }
    const bucket = ASSETS_BUCKET;
    const jobId = (event.jobId as string) || randomUUID();

    const uploads = await Promise.all(
        (check.items || []).map(async (item) => ({
            name: item.path,
            uploadRef: { jobId, name: item.path },
            ...(await presignPut(bucket, uploadKeyFor(jobId, item.path), item.contentType, item.sizeBytes)),
        }))
    );
    return lambdaResponse(200, { jobId, uploads, expiresAt: presignExpiresAt(), maxUploadBytes: maxUploadBytes() });
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
