/**
 * multipart.ts unit tests.
 * api.spec.ts exercises this indirectly through the API handler; this covers
 * parseMultipartCompileBody's own parsing/rejection branches directly, including
 * the conflicting-inputs case (two main file parts).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { parseMultipartCompileBody, isMultipartFormData } from "@/adapters/lambda-layer/multipart.js";

const CRLF = "\r\n";

function buildMultipart(partsRaw: string[]): { body: Buffer; contentType: string } {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const chunks: string[] = [];
    for (const part of partsRaw) {
        chunks.push(`--${boundary}${CRLF}${part}${CRLF}`);
    }
    chunks.push(`--${boundary}--${CRLF}`);
    return {
        body: Buffer.from(chunks.join(""), "utf-8"),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function filePart(fieldname: string, filename: string, content: string): string {
    return (
        `Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"${CRLF}` +
        `Content-Type: application/octet-stream${CRLF}${CRLF}` +
        content
    );
}

function fieldPart(fieldname: string, value: string): string {
    return `Content-Disposition: form-data; name="${fieldname}"${CRLF}${CRLF}${value}`;
}

describe("multipart/parseMultipartCompileBody", () => {
    it("parses a single main file into mainTyp base64", async () => {
        const { body, contentType } = buildMultipart([filePart("main", "main.typ", "#Hello")]);
        const doc = await parseMultipartCompileBody(body, contentType);
        assert.strictEqual(Buffer.from(doc.mainTyp, "base64").toString("utf-8"), "#Hello");
    });

    it("rejects when two main file parts are sent (main + mainTyp)", async () => {
        const { body, contentType } = buildMultipart([
            filePart("main", "main.typ", "#First"),
            filePart("mainTyp", "main2.typ", "#Second"),
        ]);
        await assert.rejects(
            () => parseMultipartCompileBody(body, contentType),
            /Only one main \.typ file allowed/
        );
    });

    it("rejects when two main file parts are sent (file + file)", async () => {
        const { body, contentType } = buildMultipart([
            filePart("file", "a.typ", "#A"),
            filePart("file", "b.typ", "#B"),
        ]);
        await assert.rejects(
            () => parseMultipartCompileBody(body, contentType),
            /Only one main \.typ file allowed/
        );
    });

    it("rejects when no main file part is present", async () => {
        const { body, contentType } = buildMultipart([fieldPart("documentId", "doc-1")]);
        await assert.rejects(
            () => parseMultipartCompileBody(body, contentType),
            /Missing required part/
        );
    });

    it("collects multiple extraTyp parts without conflict", async () => {
        const { body, contentType } = buildMultipart([
            filePart("main", "main.typ", "#Main"),
            filePart("extraTyp", "a.typ", "#A"),
            filePart("extraTyp", "b.typ", "#B"),
        ]);
        const doc = await parseMultipartCompileBody(body, contentType);
        assert.strictEqual(doc.extraTyps?.length, 2);
        assert.strictEqual(doc.extraTyps?.[0].name, "a.typ");
        assert.strictEqual(doc.extraTyps?.[1].name, "b.typ");
    });

    it("busboy strips directory components from filename, so nested extraTyp paths degrade to basenames", async () => {
        // Documents actual multipart behavior: unlike the JSON `extraTyps` field (which takes an
        // explicit `name` and supports nested paths, e.g. "lib/module.typ"), a multipart file part's
        // filename is stripped to its basename by busboy before this code ever sees it — the
        // "path.includes('/')" branch in multipart.ts is effectively dead for multipart uploads.
        const { body, contentType } = buildMultipart([
            filePart("main", "main.typ", "#Main"),
            filePart("extraTyp", "lib/module.typ", "#Module"),
        ]);
        const doc = await parseMultipartCompileBody(body, contentType);
        assert.strictEqual(doc.extraTyps?.[0].name, "module.typ");
    });

    it("rejects an extraTyp file whose name doesn't end in .typ", async () => {
        const { body, contentType } = buildMultipart([
            filePart("main", "main.typ", "#Main"),
            filePart("extraTyp", "readme.txt", "not typst"),
        ]);
        await assert.rejects(
            () => parseMultipartCompileBody(body, contentType),
            /Extra \.typ part.*must end with \.typ/
        );
    });

    it("maps documentId, storeToS3, outputFormat, and pdfStandard fields", async () => {
        const { body, contentType } = buildMultipart([
            filePart("main", "main.typ", "#Main"),
            fieldPart("documentId", "doc-42"),
            fieldPart("storeToS3", "true"),
            fieldPart("outputFormat", "svg"),
            fieldPart("pdfStandard", "a-2b"),
        ]);
        const doc = await parseMultipartCompileBody(body, contentType);
        assert.strictEqual(doc.documentId, "doc-42");
        assert.strictEqual(doc.storeToS3, true);
        assert.strictEqual(doc.outputFormat, "svg");
        assert.strictEqual(doc.pdfStandard, "a-2b");
    });
});

describe("multipart/isMultipartFormData", () => {
    it("returns true for a multipart content-type header", () => {
        assert.strictEqual(isMultipartFormData("multipart/form-data; boundary=abc"), true);
    });

    it("is case-insensitive and tolerates leading whitespace", () => {
        assert.strictEqual(isMultipartFormData("  MULTIPART/Form-Data; boundary=abc"), true);
    });

    it("returns false for a JSON content-type", () => {
        assert.strictEqual(isMultipartFormData("application/json"), false);
    });

    it("returns false for undefined", () => {
        assert.strictEqual(isMultipartFormData(undefined), false);
    });
});
