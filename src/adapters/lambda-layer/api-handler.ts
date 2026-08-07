/**
 * API Gateway HTTP API v2 adapter.
 * Transforms REST requests to Lambda events and returns HTTP responses.
 * Supports JSON and multipart/form-data for POST /compile.
 */
import { handler as lambdaHandler } from "./handler.js";
import { validateRestPayloadSize, validateDocumentId } from "@/core/validate.js";
import {
    parseMultipartCompileBody,
    parseMultipartAssetBody,
    isMultipartFormData,
} from "./multipart.js";

function httpResponse(statusCode: number, body: object | string, headers: Record<string, string> = {}) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

function getContentType(event: Record<string, unknown>): string | undefined {
    const headers = (event.headers as Record<string, string | string[] | undefined>) || {};
    const ct = headers["content-type"] ?? headers["Content-Type"];
    return Array.isArray(ct) ? ct[0] : ct;
}

function parseApiEvent(event: Record<string, unknown>) {
    const bodyRaw = event.body;
    const isBase64 = !!(event as { isBase64Encoded?: boolean }).isBase64Encoded;
    let bodyBuffer: Buffer | null = null;
    let bodyStr: string | null = null;
    if (bodyRaw) {
        const buf =
            typeof bodyRaw === "string"
                ? isBase64
                    ? Buffer.from(bodyRaw, "base64")
                    : Buffer.from(bodyRaw, "utf8")
                : null;
        if (buf) {
            bodyBuffer = buf;
            bodyStr = buf.toString("utf-8");
        }
    }

    const reqCtx = event.requestContext as { http?: { method?: string } } | undefined;
    const rawPath = event.rawPath as string | undefined;
    const path = event.path as string | undefined;
    const routeKey = (event.routeKey as string) || (reqCtx?.http?.method + " " + (rawPath || path || ""));
    const pathParams = (event.pathParameters as Record<string, string>) || {};
    const id = pathParams.id || pathParams.path || pathParams.proxy;
    const contentType = getContentType(event);

    return { bodyBuffer, bodyStr, routeKey, pathParams, id, contentType };
}

export async function handler(event: Record<string, unknown>): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
    const { bodyBuffer, bodyStr, routeKey, id, contentType } = parseApiEvent(event);

    if ((event.requestContext as { http?: { method?: string } })?.http?.method === "OPTIONS") {
        return httpResponse(200, "", {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        });
    }

    if (bodyBuffer ?? bodyStr) {
        const sizeCheck = validateRestPayloadSize(bodyBuffer ?? bodyStr ?? null);
        if (!sizeCheck.valid) {
            return httpResponse(413, { error: sizeCheck.error });
        }
    }

    const method = (event.requestContext as { http?: { method?: string } })?.http?.method || (routeKey?.split(" ")[0] ?? "");
    const path = (event.rawPath as string) || (event.path as string) || "";

    if (method === "POST" && (path === "/compile" || path?.startsWith("/compile"))) {
        return await handleCompile(bodyBuffer, bodyStr, contentType);
    }
    if (method === "GET" && (path === "/status" || path?.startsWith("/status/")) && id) {
        const statusRes = await handleStatus(id);
        if (statusRes.statusCode === 404) {
            return await handleBatchStatus(id);
        }
        return statusRes;
    }
    if (method === "POST" && path === "/assets") {
        return await handleUploadAsset(bodyBuffer, bodyStr, contentType);
    }
    if (method === "GET" && path === "/assets") {
        return await handleListAssets(event);
    }
    if (method === "DELETE" && path?.startsWith("/assets/") && id) {
        return await handleDeleteAsset(id);
    }

    return httpResponse(404, { error: "Not found" });
}

async function handleCompile(
    bodyBuffer: Buffer | null,
    bodyStr: string | null,
    contentType: string | undefined
) {
    if (!bodyBuffer && !bodyStr) {
        return httpResponse(400, { error: "Request body is required" });
    }

    if (bodyBuffer && contentType && isMultipartFormData(contentType)) {
        try {
            const doc = await parseMultipartCompileBody(bodyBuffer, contentType);
            const res = await lambdaHandler({ ...doc, action: "compile" } as Parameters<typeof lambdaHandler>[0], {});
            return toHttpResponse(res);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid multipart body";
            return httpResponse(400, { error: message });
        }
    }

    if (!bodyStr || bodyStr.trim().length === 0) {
        return httpResponse(400, { error: "Request body is required" });
    }
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(bodyStr);
    } catch {
        return httpResponse(400, { error: "Invalid JSON body" });
    }
    const documents = Array.isArray(payload.documents) ? payload.documents : null;
    if (!documents || documents.length === 0) {
        return httpResponse(400, { error: "documents array is required and must have at least one item" });
    }
    if (documents.length === 1) {
        const doc = documents[0] as Record<string, unknown>;
        const res = await lambdaHandler({ ...doc, action: "compile" } as Parameters<typeof lambdaHandler>[0], {});
        return toHttpResponse(res);
    }
    const res = await lambdaHandler({
        documents,
        action: "batch",
        ...(payload.storeToS3 !== undefined && { storeToS3: payload.storeToS3 }),
        ...(payload.outputS3 !== undefined && { outputS3: payload.outputS3 }),
    } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleStatus(id: string) {
    const idCheck = validateDocumentId(id);
    if (!idCheck.valid) {
        return httpResponse(400, { error: idCheck.error });
    }
    const res = await lambdaHandler({ action: "status", documentId: id } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleBatchStatus(batchId: string) {
    const res = await lambdaHandler({
        action: "batchstatus",
        batchId,
    } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleUploadAsset(
    bodyBuffer: Buffer | null,
    bodyStr: string | null,
    contentType: string | undefined
) {
    if (!bodyBuffer && !bodyStr) {
        return httpResponse(400, { error: "Request body is required" });
    }

    if (bodyBuffer && contentType && isMultipartFormData(contentType)) {
        try {
            const asset = await parseMultipartAssetBody(bodyBuffer, contentType);
            const res = await lambdaHandler({ ...asset, action: "uploadasset" } as Parameters<typeof lambdaHandler>[0], {});
            return toHttpResponse(res);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid multipart body";
            return httpResponse(400, { error: message });
        }
    }

    if (!bodyStr || bodyStr.trim().length === 0) {
        return httpResponse(400, { error: "Request body is required" });
    }
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(bodyStr);
    } catch {
        return httpResponse(400, { error: "Invalid JSON body" });
    }
    const res = await lambdaHandler({ ...payload, action: "uploadasset" } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleListAssets(event: Record<string, unknown>) {
    const query = (event.queryStringParameters as Record<string, string> | undefined) || {};
    const res = await lambdaHandler({
        action: "listassets",
        ...(query.prefix && { prefix: query.prefix }),
    } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleDeleteAsset(assetPath: string) {
    const res = await lambdaHandler({
        action: "deleteasset",
        assetPath,
    } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

function toHttpResponse(lambdaRes: { statusCode: number; headers?: Record<string, string>; body: string }) {
    const statusCode = lambdaRes.statusCode;
    const body = typeof lambdaRes.body === "string" ? lambdaRes.body : JSON.stringify(lambdaRes.body);
    const headers = { ...lambdaRes.headers, "Access-Control-Allow-Origin": "*" };
    return { statusCode, headers, body };
}
