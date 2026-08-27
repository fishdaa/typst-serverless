/**
 * Presigned upload validation.
 * A presigned PUT is an unauthenticated write into the bucket, so these bounds
 * (extension, content type, exact size) are the security boundary — not polish.
 */
import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import {
    validateUploadRequest,
    validateUploadRequests,
    maxUploadBytes,
    DEFAULT_MAX_UPLOAD_BYTES,
    MAX_PRESIGN_BATCH,
    ALLOWED_UPLOAD_EXTENSIONS,
} from "@/core/uploads.js";
import { validateJobId, validateUploadRef } from "@/core/validate.js";

const OK = { path: "demo/bg.png", contentType: "image/png", sizeBytes: 1024 };

describe("upload validation", () => {
    afterEach(() => {
        delete process.env.TYPST_MAX_UPLOAD_BYTES;
    });

    describe("validateUploadRequest", () => {
        it("accepts a well-formed request", () => {
            assert.strictEqual(validateUploadRequest(OK).valid, true);
        });

        it("accepts every allowed input extension", () => {
            for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
                const result = validateUploadRequest({ ...OK, path: `in/file${ext}` });
                assert.strictEqual(result.valid, true, `${ext} should be allowed: ${result.error}`);
            }
        });

        it("rejects an extension the compiler cannot consume", () => {
            const result = validateUploadRequest({ ...OK, path: "payload.sh" });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("allowed extension"));
        });

        it("rejects a missing extension", () => {
            assert.strictEqual(validateUploadRequest({ ...OK, path: "background" }).valid, false);
        });

        it("rejects path traversal", () => {
            const result = validateUploadRequest({ ...OK, path: "../../etc/evil.png" });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("traversal"));
        });

        it("rejects a leading slash", () => {
            assert.strictEqual(validateUploadRequest({ ...OK, path: "/abs/bg.png" }).valid, false);
        });

        it("rejects a missing path", () => {
            assert.strictEqual(validateUploadRequest({ ...OK, path: undefined }).valid, false);
        });

        it("labels the path field per namespace", () => {
            const result = validateUploadRequest({ ...OK, path: undefined }, "name");
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("name"), result.error);
            assert(!result.error?.includes("assetPath"), result.error);
        });

        it("requires contentType, because it is signed into the URL", () => {
            const result = validateUploadRequest({ ...OK, contentType: undefined });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("contentType"));
        });

        it("rejects a non-ASCII contentType (header injection surface)", () => {
            assert.strictEqual(validateUploadRequest({ ...OK, contentType: "image/png\r\nX: y" }).valid, false);
        });

        it("requires sizeBytes, because it is signed into the URL", () => {
            const result = validateUploadRequest({ ...OK, sizeBytes: undefined });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("sizeBytes"));
        });

        it("rejects a zero, negative, or fractional sizeBytes", () => {
            for (const sizeBytes of [0, -1, 1.5, "big"]) {
                assert.strictEqual(
                    validateUploadRequest({ ...OK, sizeBytes }).valid,
                    false,
                    `sizeBytes ${sizeBytes} should be rejected`
                );
            }
        });

        it("rejects a size above the ceiling", () => {
            const result = validateUploadRequest({ ...OK, sizeBytes: DEFAULT_MAX_UPLOAD_BYTES + 1 });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("upload limit"));
        });

        it("honours a configured ceiling", () => {
            process.env.TYPST_MAX_UPLOAD_BYTES = "2048";
            assert.strictEqual(maxUploadBytes(), 2048);
            assert.strictEqual(validateUploadRequest({ ...OK, sizeBytes: 2048 }).valid, true);
            assert.strictEqual(validateUploadRequest({ ...OK, sizeBytes: 2049 }).valid, false);
        });

        it("falls back to the default ceiling when the env var is nonsense", () => {
            process.env.TYPST_MAX_UPLOAD_BYTES = "not-a-number";
            assert.strictEqual(maxUploadBytes(), DEFAULT_MAX_UPLOAD_BYTES);
        });
    });

    describe("validateUploadRequests", () => {
        it("normalizes a valid list", () => {
            const result = validateUploadRequests([
                { assetPath: "a.png", contentType: "image/png", sizeBytes: 10 },
                { assetPath: "b.svg", contentType: "image/svg+xml", sizeBytes: "20" },
            ]);
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.items, [
                { path: "a.png", contentType: "image/png", sizeBytes: 10 },
                { path: "b.svg", contentType: "image/svg+xml", sizeBytes: 20 },
            ]);
        });

        it("reads the name field in the job-upload namespace", () => {
            const result = validateUploadRequests(
                [{ name: "bg.png", contentType: "image/png", sizeBytes: 10 }],
                "name"
            );
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.items?.[0].path, "bg.png");
        });

        it("rejects an empty or non-array list", () => {
            assert.strictEqual(validateUploadRequests([]).valid, false);
            assert.strictEqual(validateUploadRequests(undefined).valid, false);
            assert.strictEqual(validateUploadRequests({ assetPath: "a.png" }).valid, false);
        });

        it("caps how many files one call may sign", () => {
            const items = Array.from({ length: MAX_PRESIGN_BATCH + 1 }, (_, i) => ({
                assetPath: `a${i}.png`,
                contentType: "image/png",
                sizeBytes: 10,
            }));
            const result = validateUploadRequests(items);
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes(String(MAX_PRESIGN_BATCH)));
        });

        it("rejects duplicate paths in one call", () => {
            const result = validateUploadRequests([
                { assetPath: "a.png", contentType: "image/png", sizeBytes: 10 },
                { assetPath: "a.png", contentType: "image/png", sizeBytes: 20 },
            ]);
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("duplicate"));
        });

        it("reports the offending index", () => {
            const result = validateUploadRequests([
                { assetPath: "a.png", contentType: "image/png", sizeBytes: 10 },
                { assetPath: "evil.sh", contentType: "text/plain", sizeBytes: 10 },
            ]);
            assert.strictEqual(result.valid, false);
            assert(result.error?.startsWith("[1]"), result.error);
        });
    });

    describe("validateJobId", () => {
        it("accepts a uuid", () => {
            assert.strictEqual(validateJobId("3f1b2c4d-0000-4aaa-8bbb-1234567890ab").valid, true);
        });

        it("rejects a missing or malformed id", () => {
            for (const id of [undefined, "", "has/slash", "has space", "..", "x".repeat(129)]) {
                assert.strictEqual(validateJobId(id).valid, false, `${id} should be rejected`);
            }
        });
    });

    describe("validateUploadRef", () => {
        it("accepts { jobId, name }", () => {
            assert.strictEqual(validateUploadRef({ jobId: "job-1", name: "bg.png" }).valid, true);
        });

        it("rejects a non-object", () => {
            assert.strictEqual(validateUploadRef("job-1/bg.png").valid, false);
            assert.strictEqual(validateUploadRef([{ jobId: "job-1", name: "bg.png" }]).valid, false);
        });

        it("rejects a bad jobId", () => {
            assert.strictEqual(validateUploadRef({ jobId: "../other-job", name: "bg.png" }).valid, false);
        });

        it("rejects traversal in the name, which would escape the job prefix", () => {
            const result = validateUploadRef({ jobId: "job-1", name: "../../assets/logo.png" });
            assert.strictEqual(result.valid, false);
            assert(result.error?.includes("uploadRef.name"));
        });

        it("rejects a missing name", () => {
            assert.strictEqual(validateUploadRef({ jobId: "job-1" }).valid, false);
        });
    });
});
