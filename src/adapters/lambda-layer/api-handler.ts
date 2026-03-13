/**
 * API Gateway HTTP API v2 adapter.
 * Transforms REST requests to Lambda events and returns HTTP responses.
 */
import { handler as lambdaHandler } from "./handler.js";
import { validateRestPayloadSize, validateDocumentId } from "../../core/validate.js";

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

function parseApiEvent(event: Record<string, unknown>) {
    const bodyRaw = event.body;
    const isBase64 = !!(event as { isBase64Encoded?: boolean }).isBase64Encoded;
    let body: string | null = null;
    if (bodyRaw) {
        const buf = isBase64 ? Buffer.from(bodyRaw as string, "base64") : Buffer.from(bodyRaw as string, "utf8");
        body = buf.toString("utf-8");
    }

    const reqCtx = event.requestContext as { http?: { method?: string } } | undefined;
    const rawPath = event.rawPath as string | undefined;
    const path = event.path as string | undefined;
    const routeKey = (event.routeKey as string) || (reqCtx?.http?.method + " " + (rawPath || path || ""));
    const pathParams = (event.pathParameters as Record<string, string>) || {};
    const id = pathParams.id || pathParams.proxy;

    return { body, routeKey, pathParams, id };
}

export async function handler(event: Record<string, unknown>): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
    const { body, routeKey, id } = parseApiEvent(event);

    if ((event.requestContext as { http?: { method?: string } })?.http?.method === "OPTIONS") {
        return httpResponse(200, "", {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        });
    }

    if (body) {
        const sizeCheck = validateRestPayloadSize(body);
        if (!sizeCheck.valid) {
            return httpResponse(413, { error: sizeCheck.error });
        }
    }

    const method = (event.requestContext as { http?: { method?: string } })?.http?.method || (routeKey?.split(" ")[0] ?? "");
    const path = (event.rawPath as string) || (event.path as string) || "";

    if (method === "POST" && (path === "/compile" || path?.startsWith("/compile"))) {
        return await handleCompile(body);
    }
    if (method === "POST" && (path === "/batch" || path?.startsWith("/batch"))) {
        return await handleBatch(body);
    }
    if (method === "GET" && id) {
        if (path?.endsWith("/pdf")) {
            return await handleRetrieve(id);
        }
        return await handleStatus(id);
    }

    return httpResponse(404, { error: "Not found" });
}

async function handleCompile(bodyStr: string | null) {
    if (!bodyStr || bodyStr.trim().length === 0) {
        return httpResponse(400, { error: "Request body is required" });
    }
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(bodyStr);
    } catch {
        return httpResponse(400, { error: "Invalid JSON body" });
    }
    const res = await lambdaHandler({ ...payload, action: "compile" } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

async function handleBatch(bodyStr: string | null) {
    if (!bodyStr || bodyStr.trim().length === 0) {
        return httpResponse(400, { error: "Request body is required" });
    }
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(bodyStr);
    } catch {
        return httpResponse(400, { error: "Invalid JSON body" });
    }
    const res = await lambdaHandler({ ...payload, action: "batch" } as Parameters<typeof lambdaHandler>[0], {});
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

async function handleRetrieve(id: string) {
    const idCheck = validateDocumentId(id);
    if (!idCheck.valid) {
        return httpResponse(400, { error: idCheck.error });
    }
    const res = await lambdaHandler({ action: "retrieve", documentId: id } as Parameters<typeof lambdaHandler>[0], {});
    return toHttpResponse(res);
}

function toHttpResponse(lambdaRes: { statusCode: number; headers?: Record<string, string>; body: string }) {
    const statusCode = lambdaRes.statusCode;
    const body = typeof lambdaRes.body === "string" ? lambdaRes.body : JSON.stringify(lambdaRes.body);
    const headers = { ...lambdaRes.headers, "Access-Control-Allow-Origin": "*" };
    return { statusCode, headers, body };
}
