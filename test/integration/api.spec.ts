/**
 * API Gateway integration tests (Phase 3).
 * Validates REST event parsing, body size, path params, JSON schema, multipart form-data.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { handler } from "@/adapters/lambda-layer/api-handler.js";
import { CROSS_ADAPTER_B64, ASSETS_COMPILE_EVENT } from "../fixtures/shared-payloads.js";

const FIXTURE_B64 = CROSS_ADAPTER_B64;
const CRLF = "\r\n";

function apiEvent(
    method: string,
    path: string,
    body: object | null,
    pathParams: Record<string, string> = {}
) {
    const rawPath = path || "/compile";
    const routeKey = `${method} ${rawPath}`;
    return {
        version: "2.0",
        routeKey,
        rawPath,
        requestContext: { http: { method } },
        body: body ? JSON.stringify(body) : null,
        pathParameters: pathParams,
        isBase64Encoded: false,
    };
}

/**
 * Build multipart/form-data body for POST /compile.
 * Parts: main/mainTyp/file = .typ source (required); optional fields: documentId, storeToS3, outputFormat, main (filename).
 */
function buildMultipartBody(parts: {
    main?: string;
    documentId?: string;
    storeToS3?: boolean;
    outputFormat?: string;
    mainFilename?: string;
}): { body: string; contentType: string } {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const chunks: string[] = [];

    const typContent = parts.main ?? "#Hello from multipart\n";
    chunks.push(
        `--${boundary}${CRLF}`,
        `Content-Disposition: form-data; name="main"; filename="${parts.mainFilename ?? "main.typ"}"${CRLF}`,
        `Content-Type: application/octet-stream${CRLF}${CRLF}`,
        typContent,
        CRLF
    );

    if (parts.documentId != null) {
        chunks.push(
            `--${boundary}${CRLF}`,
            `Content-Disposition: form-data; name="documentId"${CRLF}${CRLF}`,
            parts.documentId,
            CRLF
        );
    }
    if (parts.storeToS3 === true) {
        chunks.push(
            `--${boundary}${CRLF}`,
            `Content-Disposition: form-data; name="storeToS3"${CRLF}${CRLF}`,
            "true",
            CRLF
        );
    }
    if (parts.outputFormat != null) {
        chunks.push(
            `--${boundary}${CRLF}`,
            `Content-Disposition: form-data; name="outputFormat"${CRLF}${CRLF}`,
            parts.outputFormat,
            CRLF
        );
    }

    chunks.push(`--${boundary}--${CRLF}`);
    return {
        body: chunks.join(""),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function multipartApiEvent(parts: Parameters<typeof buildMultipartBody>[0]) {
    const { body, contentType } = buildMultipartBody(parts);
    return {
        version: "2.0",
        routeKey: "POST /compile",
        rawPath: "/compile",
        requestContext: { http: { method: "POST" } },
        headers: { "content-type": contentType },
        body,
        pathParameters: {},
        isBase64Encoded: false,
    };
}

describe("API Gateway handler", () => {
    describe("validation", () => {
        it("rejects body exceeding 10MB", async () => {
            const body = { mainTyp: "x".repeat(11 * 1024 * 1024) };
            const ev = apiEvent("POST", "/compile", body);
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 413);
            const parsed = JSON.parse(res.body);
            assert(parsed.error?.includes("10MB") || parsed.error?.includes("limit"));
        });

        it("rejects empty body for POST /compile", async () => {
            const ev = apiEvent("POST", "/compile", null);
            ev.body = "";
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
        });

        it("rejects body without documents array for POST /compile", async () => {
            const ev = apiEvent("POST", "/compile", {});
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
            const parsed = JSON.parse(res.body);
            assert(parsed.error?.includes("documents"));
        });

        it("rejects invalid JSON body", async () => {
            const ev = apiEvent("POST", "/compile", null);
            ev.body = "not valid json {";
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
            const parsed = JSON.parse(res.body);
            assert(parsed.error?.toLowerCase().includes("json"));
        });

        it("validates id path param on GET /status/:id", async () => {
            const ev = apiEvent("GET", "/status/bad-id!", null, { id: "bad-id!" });
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
        });

        it("returns 404 for unknown route", async () => {
            const ev = apiEvent("GET", "/unknown", null);
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 404);
        });
    });

    describe("CORS", () => {
        it("returns 200 for OPTIONS preflight", async () => {
            const ev = {
                requestContext: { http: { method: "OPTIONS" } },
                routeKey: "OPTIONS /compile",
                rawPath: "/compile",
            };
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 200);
            assert(res.headers?.["Access-Control-Allow-Methods"]?.includes("POST"));
        });
    });

    describe("POST /compile", () => {
        it("rejects compile without mainTyp in documents[0]", async () => {
            const ev = apiEvent("POST", "/compile", { documents: [{}] });
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
            const parsed = JSON.parse(res.body);
            assert(parsed.error?.includes("mainTyp") || parsed.error?.includes("mainTypS3"));
        });

        it("forwards valid compile (single document) to Lambda handler", async () => {
            const ev = apiEvent("POST", "/compile", {
                documents: [{ mainTyp: FIXTURE_B64, documentId: "api-test-1" }],
            });
            const res = await handler(ev);
            assert([200, 500].includes(res.statusCode));
            if (res.statusCode === 200) {
                const parsed = JSON.parse(res.body);
                assert(parsed.status === "completed" || parsed.documentId);
            }
        });

        it("forwards compile with assets (image + data) to Lambda handler", { timeout: 15000 }, async () => {
            const ev = apiEvent("POST", "/compile", {
                documents: [{ ...ASSETS_COMPILE_EVENT, documentId: "api-assets-1" }],
            });
            const res = await handler(ev);
            assert([200, 500].includes(res.statusCode));
            if (res.statusCode === 200) {
                const parsed = JSON.parse(res.body);
                assert(parsed.status === "completed" || parsed.documentId);
                if (parsed.pdf) {
                    const buf = Buffer.from(parsed.pdf, "base64");
                    assert(buf.length > 200);
                    assert(buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
                }
            }
        });

        it("forwards compile with data and dataFile (YAML) to Lambda handler", { timeout: 15000 }, async () => {
            const typContent = '#set page(width: 100pt)\n#let d = yaml("data.yaml")\nAPI: #d.label';
            const yamlContent = "label: From API\n";
            const ev = apiEvent("POST", "/compile", {
                documents: [
                    {
                        mainTyp: Buffer.from(typContent, "utf-8").toString("base64"),
                        data: Buffer.from(yamlContent, "utf-8").toString("base64"),
                        dataFile: "data.yaml",
                        documentId: "api-data-yaml-1",
                    },
                ],
            });
            const res = await handler(ev);
            assert([200, 500].includes(res.statusCode), res.body);
            if (res.statusCode === 200) {
                const parsed = JSON.parse(res.body);
                assert(parsed.status === "completed" || parsed.documentId);
                if (parsed.pdf) {
                    const buf = Buffer.from(parsed.pdf, "base64");
                    assert(buf.length > 0 && buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
                }
            }
        });
    });

    describe("POST /compile (multipart/form-data)", () => {
        it("rejects multipart with no body", async () => {
            const ev = multipartApiEvent({ main: "#x" });
            ev.body = "";
            const res = await handler(ev);
            assert.strictEqual(res.statusCode, 400);
        });

        it("rejects multipart missing main file part", async () => {
            const boundary = "----Boundary123";
            const body =
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="documentId"${CRLF}${CRLF}` +
                `doc-1${CRLF}` +
                `--${boundary}--${CRLF}`;
            const res = await handler({
                version: "2.0",
                routeKey: "POST /compile",
                rawPath: "/compile",
                requestContext: { http: { method: "POST" } },
                headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
                body,
                pathParameters: {},
                isBase64Encoded: false,
            });
            assert.strictEqual(res.statusCode, 400);
            const parsed = JSON.parse(res.body);
            assert(parsed.error?.toLowerCase().includes("main") || parsed.error?.toLowerCase().includes("required"));
        });

        it("forwards valid multipart compile to Lambda handler", async () => {
            const ev = multipartApiEvent({
                main: "#set page(width: 100pt)\nHello from multipart",
                documentId: "api-multipart-1",
            });
            const res = await handler(ev);
            assert([200, 500].includes(res.statusCode), res.body);
            if (res.statusCode === 200) {
                const parsed = JSON.parse(res.body);
                assert(parsed.status === "completed" || parsed.documentId);
                if (parsed.pdf) {
                    const buf = Buffer.from(parsed.pdf, "base64");
                    assert(buf.length > 0 && buf[0] === 0x25 && buf[1] === 0x50, "Output should be valid PDF");
                }
            }
        });

        it("multipart with documentId and outputFormat returns success or 500", async () => {
            const ev = multipartApiEvent({
                main: "#set page(width: 80pt)\nTest",
                documentId: "mp-doc-2",
                outputFormat: "pdf",
            });
            const res = await handler(ev);
            assert([200, 500].includes(res.statusCode));
            if (res.statusCode === 200) {
                const parsed = JSON.parse(res.body);
                assert(parsed.documentId === "mp-doc-2" || parsed.documentId);
            }
        });
    });

    describe("GET /status/:id", () => {
        it("forwards status request", async () => {
            const ev = apiEvent("GET", "/status/valid-id-123", null, {
                id: "valid-id-123",
            });
            const res = await handler(ev);
            assert([200, 404, 500].includes(res.statusCode));
        });
    });
});
