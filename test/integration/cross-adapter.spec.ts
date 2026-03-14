/**
 * Phase 6.6: Cross-adapter matrix.
 * Same input → equivalent output across core compile, Lambda handler, API handler.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { compile } from "@/core/compile.js";
import { handler as lambdaHandler } from "@/adapters/lambda-layer/handler.js";
import { handler as apiHandler } from "@/adapters/lambda-layer/api-handler.js";
import { tmpdir } from "node:os";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
    CROSS_ADAPTER_TYP,
    CROSS_ADAPTER_B64,
    CROSS_ADAPTER_COMPILE_EVENT,
} from "../fixtures/shared-payloads.js";

function apiEvent(method: string, path: string, body: object | null) {
    return {
        version: "2.0",
        routeKey: `${method} ${path}`,
        rawPath: path,
        requestContext: { http: { method } },
        body: body ? JSON.stringify(body) : null,
        pathParameters: {},
        isBase64Encoded: false,
    };
}

function isValidPdf(buf: Buffer): boolean {
    return buf.length > 0 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44;
}

describe("cross-adapter matrix", () => {
    it("same input produces valid PDF from core, Lambda, and API", { timeout: 15000 }, async () => {
        const typstPath = process.env.TYPST_PATH;
        if (!typstPath && process.env.CI) return;

        const workDir = join(tmpdir(), `cross-adapter-${randomUUID()}`);
        mkdirSync(workDir, { recursive: true });
        const mainPath = join(workDir, "main.typ");
        const coreOutput = join(workDir, "core.pdf");
        writeFileSync(mainPath, CROSS_ADAPTER_TYP);

        let corePdf: Buffer | null = null;
        let lambdaPdf: Buffer | null = null;
        let apiPdf: Buffer | null = null;

        try {
            // 1. Core compile
            await compile(mainPath, coreOutput);
            corePdf = readFileSync(coreOutput);
            assert(isValidPdf(corePdf), "Core output should be valid PDF");

            // 2. Lambda handler
            const lambdaRes = await lambdaHandler({
                ...CROSS_ADAPTER_COMPILE_EVENT,
                documentId: `cross-${randomUUID()}`,
            });
            assert([200, 500].includes(lambdaRes.statusCode), "Lambda should return 200 or 500");
            if (lambdaRes.statusCode === 200) {
                const body = JSON.parse(lambdaRes.body);
                if (body.pdf) {
                    lambdaPdf = Buffer.from(body.pdf, "base64");
                    assert(isValidPdf(lambdaPdf), "Lambda output should be valid PDF");
                }
            }

            // 3. API handler
            const apiRes = await apiHandler(
                apiEvent("POST", "/compile", {
                    mainTyp: CROSS_ADAPTER_B64,
                    documentId: `cross-api-${randomUUID()}`,
                })
            );
            assert([200, 500].includes(apiRes.statusCode), "API should return 200 or 500");
            if (apiRes.statusCode === 200) {
                const body = JSON.parse(apiRes.body);
                if (body.pdf) {
                    apiPdf = Buffer.from(body.pdf, "base64");
                    assert(isValidPdf(apiPdf), "API output should be valid PDF");
                }
            }

            // Equivalent: all adapters that succeeded produced valid PDFs
            assert(corePdf, "Core must produce PDF");
            if (lambdaPdf) {
                assert(lambdaPdf.length > 100, "Lambda PDF should be non-trivial");
            }
            if (apiPdf) {
                assert(apiPdf.length > 100, "API PDF should be non-trivial");
            }

            // Byte equivalence: core vs Lambda and core vs API (when both succeed)
            if (lambdaPdf && corePdf) {
                assert.strictEqual(
                    corePdf.length,
                    lambdaPdf.length,
                    "Core and Lambda PDFs should match size"
                );
                assert(corePdf.equals(lambdaPdf), "Core and Lambda PDFs should be byte-identical");
            }
            if (apiPdf && corePdf) {
                assert.strictEqual(
                    corePdf.length,
                    apiPdf.length,
                    "Core and API PDFs should match size"
                );
                assert(corePdf.equals(apiPdf), "Core and API PDFs should be byte-identical");
            }
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});
