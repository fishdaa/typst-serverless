/**
 * API Gateway HTTP API v2 adapter.
 * Transforms REST requests to Lambda events and returns HTTP responses.
 * Routes: POST /compile, GET /documents/:id (status), GET /documents/:id/pdf (retrieve)
 */
import { handler as lambdaHandler } from "./handler.js";
import {
  validateRestPayloadSize,
  validateDocumentId,
} from "../../core/validate.js";

function httpResponse(statusCode, body, headers = {}) {
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

/**
 * Parse API Gateway HTTP API v2 event into Lambda event format.
 * Supports: routeKey, rawPath, pathParameters, body, isBase64Encoded.
 */
function parseApiEvent(event) {
  const bodyRaw = event.body;
  const isBase64 = !!event.isBase64Encoded;
  let body = null;
  if (bodyRaw) {
    const buf = isBase64 ? Buffer.from(bodyRaw, "base64") : Buffer.from(bodyRaw, "utf8");
    body = buf.toString("utf-8");
  }

  const routeKey = event.routeKey || event.requestContext?.http?.method + " " + (event.rawPath || event.path || "");
  const pathParams = event.pathParameters || {};
  const id = pathParams.id || pathParams.proxy;

  return { body, routeKey, pathParams, id };
}

/**
 * API Gateway HTTP API v2 handler.
 */
export async function handler(event) {
  const { body, routeKey, id } = parseApiEvent(event);

  // CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return httpResponse(200, "", {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  }

  // Body size validation (10MB for REST)
  if (body) {
    const sizeCheck = validateRestPayloadSize(body);
    if (!sizeCheck.valid) {
      return httpResponse(413, { error: sizeCheck.error });
    }
  }

  const method = event.requestContext?.http?.method || (routeKey?.split(" ")[0] ?? "");
  const path = event.rawPath || event.path || "";

  if (method === "POST" && (path === "/compile" || path?.startsWith("/compile"))) {
    return await handleCompile(body);
  }
  if (method === "GET" && id) {
    if (path?.endsWith("/pdf")) {
      return await handleRetrieve(id);
    }
    return await handleStatus(id);
  }

  return httpResponse(404, { error: "Not found" });
}

async function handleCompile(bodyStr) {
  if (!bodyStr || bodyStr.trim().length === 0) {
    return httpResponse(400, { error: "Request body is required" });
  }
  let payload;
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    return httpResponse(400, { error: "Invalid JSON body" });
  }
  const lambdaEvent = { ...payload, action: "compile" };
  const res = await lambdaHandler(lambdaEvent, {});
  return toHttpResponse(res);
}

async function handleStatus(id) {
  const idCheck = validateDocumentId(id);
  if (!idCheck.valid) {
    return httpResponse(400, { error: idCheck.error });
  }
  const res = await lambdaHandler({ action: "status", documentId: id }, {});
  return toHttpResponse(res);
}

async function handleRetrieve(id) {
  const idCheck = validateDocumentId(id);
  if (!idCheck.valid) {
    return httpResponse(400, { error: idCheck.error });
  }
  const res = await lambdaHandler({ action: "retrieve", documentId: id }, {});
  return toHttpResponse(res);
}

function toHttpResponse(lambdaRes) {
  const statusCode = lambdaRes.statusCode;
  const body = typeof lambdaRes.body === "string" ? lambdaRes.body : JSON.stringify(lambdaRes.body);
  const headers = { ...lambdaRes.headers, "Access-Control-Allow-Origin": "*" };
  return { statusCode, headers, body };
}
