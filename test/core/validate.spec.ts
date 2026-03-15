/**
 * Validation unit tests.
 * Tests: payload size, document_id, S3 key, event schema.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import {
    validatePayloadSize,
    validateDocumentId,
    validateS3Key,
    validateS3Ref,
    validateMainTyp,
    validateCompileEvent,
    validateStatusEvent,
    validateWebhookUrl,
    validateBatchEvent,
    validateData,
    validateDataFile,
} from "@/core/validate.js";

describe("core/validate", () => {
    describe("validatePayloadSize", () => {
        it("accepts small sync payload", () => {
            const r = validatePayloadSize({ mainTyp: "aGk=" }, false);
            assert.strictEqual(r.valid, true);
        });

        it("rejects oversized sync payload", () => {
            const big = { mainTyp: "x".repeat(7 * 1024 * 1024) };
            const r = validatePayloadSize(big, false);
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("6MB"));
        });

        it("rejects oversized async payload", () => {
            const big = { mainTyp: "x".repeat(300 * 1024) };
            const r = validatePayloadSize(big, true);
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("256KB"));
        });
    });

    describe("validateDocumentId", () => {
        it("accepts valid id", () => {
            assert.strictEqual(validateDocumentId("doc-123").valid, true);
            assert.strictEqual(validateDocumentId("abc_def-123").valid, true);
        });

        it("rejects empty or invalid id", () => {
            assert.strictEqual(validateDocumentId("").valid, false);
            assert.strictEqual(validateDocumentId("x".repeat(200)).valid, false);
            assert.strictEqual(validateDocumentId("bad/key").valid, false);
        });
    });

    describe("validateS3Key", () => {
        it("accepts valid key", () => {
            assert.strictEqual(validateS3Key("path/to/file.typ").valid, true);
        });

        it("rejects path traversal", () => {
            assert.strictEqual(validateS3Key("../etc/passwd").valid, false);
            assert.strictEqual(validateS3Key("a/../b").valid, false);
        });

        it("rejects leading slash", () => {
            assert.strictEqual(validateS3Key("/absolute").valid, false);
        });
    });

    describe("validateS3Ref", () => {
        it("accepts valid ref", () => {
            assert.strictEqual(
                validateS3Ref({ bucket: "my-bucket", key: "path/main.typ" }).valid,
                true
            );
        });

        it("rejects missing bucket or key", () => {
            assert.strictEqual(validateS3Ref({ key: "x" } as { bucket: string; key: string }).valid, false);
            assert.strictEqual(validateS3Ref({ bucket: "b" } as { bucket: string; key: string }).valid, false);
        });
    });

    describe("validateMainTyp", () => {
        it("accepts undefined or empty (optional)", () => {
            assert.strictEqual(validateMainTyp(undefined).valid, true);
            assert.strictEqual(validateMainTyp(null).valid, true);
            assert.strictEqual(validateMainTyp("").valid, true);
        });

        it("accepts valid main filename", () => {
            assert.strictEqual(validateMainTyp("main.typ").valid, true);
            assert.strictEqual(validateMainTyp("report.typ").valid, true);
            assert.strictEqual(validateMainTyp("src/report.typ").valid, true);
        });

        it("rejects path traversal or leading slash", () => {
            assert.strictEqual(validateMainTyp("../main.typ").valid, false);
            assert.strictEqual(validateMainTyp("/main.typ").valid, false);
        });

        it("rejects non-.typ extension", () => {
            assert.strictEqual(validateMainTyp("main.txt").valid, false);
        });

        it("rejects non-string", () => {
            assert.strictEqual(validateMainTyp(123).valid, false);
        });
    });

    describe("validateCompileEvent", () => {
        it("accepts mainTyp base64", () => {
            const r = validateCompileEvent({ mainTyp: "IyBoZWxsbw==" });
            assert.strictEqual(r.valid, true);
        });

        it("accepts mainTypS3", () => {
            const r = validateCompileEvent({
                mainTypS3: { bucket: "b", key: "path/main.typ" },
            });
            assert.strictEqual(r.valid, true);
        });

        it("accepts main (custom main filename)", () => {
            const r = validateCompileEvent({ mainTyp: "e30=", main: "document.typ" });
            assert.strictEqual(r.valid, true);
        });

        it("rejects invalid main", () => {
            const r = validateCompileEvent({ mainTyp: "e30=", main: "../x.typ" });
            assert.strictEqual(r.valid, false);
        });

        it("rejects missing main source", () => {
            assert.strictEqual(validateCompileEvent({}).valid, false);
            assert.strictEqual(validateCompileEvent({ action: "compile" }).valid, false);
        });

        it("rejects both mainTyp and mainTypS3", () => {
            const r = validateCompileEvent({
                mainTyp: "e30=",
                mainTypS3: { bucket: "b", key: "x" },
            });
            assert.strictEqual(r.valid, false);
        });

        it("rejects invalid documentId", () => {
            const r = validateCompileEvent({
                mainTyp: "e30=",
                documentId: "bad/id",
            });
            assert.strictEqual(r.valid, false);
        });
    });

    describe("validateStatusEvent", () => {
        it("accepts documentId", () => {
            assert.strictEqual(validateStatusEvent({ documentId: "doc-1" }).valid, true);
        });

        it("rejects missing documentId", () => {
            assert.strictEqual(validateStatusEvent({}).valid, false);
        });
    });

    describe("validateWebhookUrl", () => {
        it("accepts valid https URL", () => {
            assert.strictEqual(validateWebhookUrl("https://api.example.com/cb").valid, true);
        });

        it("rejects http URL", () => {
            const r = validateWebhookUrl("http://example.com/cb");
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("https"));
        });

        it("rejects localhost", () => {
            assert.strictEqual(validateWebhookUrl("https://localhost/cb").valid, false);
            assert.strictEqual(validateWebhookUrl("https://127.0.0.1/cb").valid, false);
        });

        it("rejects invalid URL", () => {
            assert.strictEqual(validateWebhookUrl("not-a-url").valid, false);
        });
    });

    describe("validateBatchEvent", () => {
        it("accepts non-empty documents array", () => {
            const r = validateBatchEvent({ documents: [{ mainTyp: "e30=" }] });
            assert.strictEqual(r.valid, true);
            assert.strictEqual(r.documents.length, 1);
        });

        it("rejects missing documents", () => {
            assert.strictEqual(validateBatchEvent({}).valid, false);
        });

        it("rejects non-array documents", () => {
            assert.strictEqual(validateBatchEvent({ documents: "x" } as { documents: unknown }).valid, false);
        });

        it("rejects empty documents array", () => {
            assert.strictEqual(validateBatchEvent({ documents: [] }).valid, false);
        });
    });

    describe("validateDataFile", () => {
        it("accepts undefined or empty", () => {
            assert.strictEqual(validateDataFile(undefined).valid, true);
            assert.strictEqual(validateDataFile("").valid, true);
        });

        it("accepts allowed extensions", () => {
            assert.strictEqual(validateDataFile("data.json").valid, true);
            assert.strictEqual(validateDataFile("data.yaml").valid, true);
            assert.strictEqual(validateDataFile("data.yml").valid, true);
            assert.strictEqual(validateDataFile("config.toml").valid, true);
            assert.strictEqual(validateDataFile("data.csv").valid, true);
            assert.strictEqual(validateDataFile("data.xml").valid, true);
            assert.strictEqual(validateDataFile("data.cbor").valid, true);
        });

        it("rejects path traversal, leading slash, and path separators", () => {
            assert.strictEqual(validateDataFile("../data.json").valid, false);
            assert.strictEqual(validateDataFile("/data.json").valid, false);
            assert.strictEqual(validateDataFile("dir/../data.json").valid, false);
            assert.strictEqual(validateDataFile("subdir/data.json").valid, false);
        });

        it("rejects disallowed extension", () => {
            assert.strictEqual(validateDataFile("data.txt").valid, false);
            assert.strictEqual(validateDataFile("data").valid, false);
        });
    });

    describe("validateData", () => {
        it("accepts undefined or null", () => {
            assert.strictEqual(validateData(undefined).valid, true);
            assert.strictEqual(validateData(null).valid, true);
        });

        it("accepts base64 string", () => {
            assert.strictEqual(validateData("eyJoZWxsbyI6IndvcmxkIn0=").valid, true);
        });

        it("accepts S3 ref { bucket, key }", () => {
            assert.strictEqual(
                validateData({ bucket: "b", key: "data/data.json" }).valid,
                true
            );
        });

        it("rejects invalid S3 ref", () => {
            assert.strictEqual(validateData({ bucket: "b" }).valid, false);
            assert.strictEqual(validateData({ key: "x.json" }).valid, false);
        });

        it("rejects array or non-object", () => {
            assert.strictEqual(validateData([]).valid, false);
            assert.strictEqual(validateData(123).valid, false);
        });
    });
});
