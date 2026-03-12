/**
 * Lambda handler for Typst Serverless.
 * Actions: compile, status, retrieve
 */
import { compile } from "../../core/compile.js";
import { createDynamoDBState } from "../../core/state.js";
import {
  validatePayloadSize,
  validateCompileEvent,
  validateStatusEvent,
  validateS3Key,
} from "../../core/validate.js";
import { validateAssets } from "../../core/assets.js";
import { resolveMainTyp } from "./resolve-input.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TYPST_PATH = process.env.TYPST_PATH || "/opt/bin/typst";
const STATE_TABLE = process.env.TYPST_STATE_TABLE || "typst-documents";
const OUTPUT_BUCKET = process.env.TYPST_OUTPUT_BUCKET;
const PRESIGNED_EXPIRY = parseInt(process.env.TYPST_PRESIGNED_EXPIRY || "3600", 10);

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

function lambdaResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export async function handler(event, context) {
  const action = (event.action || event.Action || "compile").toLowerCase();
  const asyncInvoke = event.invocationType === "Event" || event.async === true;

  // Payload size validation
  const sizeCheck = validatePayloadSize(event, asyncInvoke);
  if (!sizeCheck.valid) {
    return lambdaResponse(413, { error: sizeCheck.error });
  }

  try {
    if (action === "compile") return await handleCompile(event);
    if (action === "status") return await handleStatus(event);
    if (action === "retrieve") return await handleRetrieve(event);
    return lambdaResponse(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(err);
    return lambdaResponse(500, { error: err.message || "Internal error" });
  }
}

async function handleCompile(event) {
  const validation = validateCompileEvent(event);
  if (!validation.valid) {
    return lambdaResponse(400, { error: validation.error });
  }
  if (event.fonts?.length) {
    const fontsCheck = validateAssets(event.fonts, "font");
    if (!fontsCheck.valid) return lambdaResponse(400, { error: fontsCheck.error });
  }
  if (event.assets?.length) {
    const assetsCheck = validateAssets(event.assets, "image");
    if (!assetsCheck.valid) return lambdaResponse(400, { error: assetsCheck.error });
  }
  if (event.outputS3 && (!event.outputS3.bucket || typeof event.outputS3.bucket !== "string")) {
    return lambdaResponse(400, { error: "outputS3.bucket is required for customer S3" });
  }

    const documentId = event.documentId || randomUUID();
  const outputS3 = event.outputS3 && typeof event.outputS3.bucket === "string" ? event.outputS3 : null;
  const storeToS3 = !!(event.storeToS3 && (OUTPUT_BUCKET || outputS3?.bucket));
  const state = createDynamoDBState({ tableName: STATE_TABLE, documentClient: dynamo });

  let workDir;
  try {
    await state.set(documentId, {
      status: "pending",
      createdAt: Date.now(),
    });
    await state.update(documentId, { status: "compiling" });

    const { workDir: wd, mainPath } = await resolveMainTyp(event, s3);
    workDir = wd;
    const outputPath = join(workDir, "output.pdf");

    await compile(mainPath, outputPath, { typstPath: TYPST_PATH });

    if (storeToS3) {
      const fs = await import("node:fs/promises");
      const pdfBuffer = await fs.readFile(outputPath);
      const bucket = outputS3?.bucket || OUTPUT_BUCKET;
      const keyPrefix = (outputS3?.keyPrefix || "outputs/").replace(/\/?$/, "/");
      const s3Key = `${keyPrefix}${documentId}.pdf`;
      const keyCheck = validateS3Key(s3Key);
      if (!keyCheck.valid) {
        throw new Error(keyCheck.error);
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: pdfBuffer,
          ContentType: "application/pdf",
        })
      );
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
        { expiresIn: PRESIGNED_EXPIRY }
      );
      await state.update(documentId, {
        status: "completed",
        s3_key: s3Key,
        s3_bucket: bucket,
      });
      return lambdaResponse(200, {
        documentId,
        status: "completed",
        s3Url: url,
      });
    }

    // Default: return PDF inline (base64)
    const fs = await import("node:fs/promises");
    const pdfBuffer = await fs.readFile(outputPath);
    await state.update(documentId, { status: "completed" });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        status: "completed",
        pdf: pdfBuffer.toString("base64"),
      }),
      isBase64Encoded: false,
    };
  } catch (err) {
    await state.update(documentId, {
      status: "failed",
      error: err.message,
    });
    return lambdaResponse(500, {
      error: err.message,
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

async function handleStatus(event) {
  const validation = validateStatusEvent(event);
  if (!validation.valid) {
    return lambdaResponse(400, { error: validation.error });
  }

  const state = createDynamoDBState({ tableName: STATE_TABLE, documentClient: dynamo });
  const doc = await state.get(event.documentId);
  if (!doc) {
    return lambdaResponse(404, { error: "Document not found" });
  }
  return lambdaResponse(200, {
    documentId: event.documentId,
    status: doc.status,
    s3_key: doc.s3_key,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    error: doc.error,
  });
}

async function handleRetrieve(event) {
  const validation = validateStatusEvent(event);
  if (!validation.valid) {
    return lambdaResponse(400, { error: validation.error });
  }

  const state = createDynamoDBState({ tableName: STATE_TABLE, documentClient: dynamo });
  const doc = await state.get(event.documentId);
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
