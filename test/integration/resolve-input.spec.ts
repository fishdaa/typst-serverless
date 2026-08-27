/**
 * resolve-input.ts unit tests (error branches).
 * Happy paths are exercised indirectly via lambda.spec.ts / localstack.spec.ts;
 * this covers missing-source, malformed-data, and S3 failure branches directly.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
    resolveMainTyp,
    resolveContentSource,
    uploadKeyFor,
    assetKeyFor,
    MissingInputError,
} from "@/adapters/lambda-layer/resolve-input.js";
import type { S3Client } from "@aws-sdk/client-s3";

function fakeS3(sendImpl: (command: unknown) => unknown): S3Client {
    return { send: sendImpl } as unknown as S3Client;
}

function s3BodyFromString(text: string) {
    async function* gen() {
        yield Buffer.from(text, "utf-8");
    }
    return { Body: gen() };
}

const NEVER_CALLED = fakeS3(() => {
    throw new Error("S3 should not be called for this test");
});

describe("resolve-input/resolveMainTyp", () => {
    it("throws when neither mainTyp nor mainTypS3 is provided", async () => {
        await assert.rejects(
            () => resolveMainTyp({}, NEVER_CALLED),
            /mainTyp, mainTypS3, mainTypAssetPath, or mainTypUploadRef required/
        );
    });

    it("resolves mainTyp from base64 without touching S3", async () => {
        const b64 = Buffer.from("#set page(width: 100pt)\nHello!").toString("base64");
        const result = await resolveMainTyp({ mainTyp: b64 }, NEVER_CALLED);
        try {
            const content = await readFile(result.mainPath, "utf-8");
            assert.strictEqual(content, "#set page(width: 100pt)\nHello!");
        } finally {
            rmSync(result.workDir, { recursive: true, force: true });
        }
    });

    it("resolves mainTypS3 by fetching from S3", async () => {
        const s3 = fakeS3(() => s3BodyFromString("#set page(width: 100pt)\nFrom S3"));
        const result = await resolveMainTyp(
            { mainTypS3: { bucket: "my-bucket", key: "main.typ" } },
            s3
        );
        try {
            const content = await readFile(result.mainPath, "utf-8");
            assert.strictEqual(content, "#set page(width: 100pt)\nFrom S3");
        } finally {
            rmSync(result.workDir, { recursive: true, force: true });
        }
    });

    it("propagates S3 GetObject failure for mainTypS3", async () => {
        const s3 = fakeS3(() => {
            throw new Error("NoSuchKey");
        });
        await assert.rejects(
            () => resolveMainTyp({ mainTypS3: { bucket: "my-bucket", key: "missing.typ" } }, s3),
            /NoSuchKey/
        );
    });

    it("throws when a font/asset item has neither bucket+key nor base64", async () => {
        const b64 = Buffer.from("#hello").toString("base64");
        await assert.rejects(
            () =>
                resolveMainTyp(
                    { mainTyp: b64, fonts: [{ name: "broken.otf" }] },
                    NEVER_CALLED
                ),
            /Asset needs bucket\+key, assetPath, uploadRef, or base64/
        );
    });

    it("propagates S3 failure when resolving a font/asset from bucket+key", async () => {
        const b64 = Buffer.from("#hello").toString("base64");
        const s3 = fakeS3(() => {
            throw new Error("AccessDenied");
        });
        await assert.rejects(
            () =>
                resolveMainTyp(
                    { mainTyp: b64, assets: [{ name: "logo.png", bucket: "b", key: "k" }] },
                    s3
                ),
            /AccessDenied/
        );
    });

    it("throws when data is neither a base64 string nor { bucket, key }", async () => {
        const b64 = Buffer.from("#hello").toString("base64");
        await assert.rejects(
            () => resolveMainTyp({ mainTyp: b64, data: 12345 }, NEVER_CALLED),
            /data must be base64 string, \{ bucket, key \}, \{ assetPath \}, or \{ uploadRef \}/
        );
    });

    it("resolves data from an S3 reference", async () => {
        const b64 = Buffer.from("#hello").toString("base64");
        const s3 = fakeS3(() => s3BodyFromString('{"hello":"world"}'));
        const result = await resolveMainTyp(
            { mainTyp: b64, data: { bucket: "b", key: "data.json" }, dataFile: "data.json" },
            s3
        );
        try {
            const content = await readFile(`${result.workDir}/data.json`, "utf-8");
            assert.strictEqual(content, '{"hello":"world"}');
        } finally {
            rmSync(result.workDir, { recursive: true, force: true });
        }
    });
    describe("uploadRef resolution", () => {
        const ASSETS_BUCKET = "assets-bucket";

        it("maps an uploadRef to uploads/<jobId>/<name> in the assets bucket", () => {
            const src = resolveContentSource({ uploadRef: { jobId: "job-1", name: "bg.png" } }, ASSETS_BUCKET);
            assert.deepStrictEqual(src, { bucket: ASSETS_BUCKET, key: "uploads/job-1/bg.png" });
        });

        it("keeps the ephemeral and library namespaces separate", () => {
            assert.strictEqual(uploadKeyFor("job-1", "bg.png"), "uploads/job-1/bg.png");
            assert.strictEqual(assetKeyFor("bg.png"), "assets/bg.png");
        });

        it("prefers assetPath when both are somehow present", () => {
            const src = resolveContentSource(
                { assetPath: "logo.png", uploadRef: { jobId: "job-1", name: "bg.png" } },
                ASSETS_BUCKET
            );
            assert.strictEqual(src.key, "assets/logo.png");
        });

        it("requires an assets bucket for an uploadRef", () => {
            assert.throws(
                () => resolveContentSource({ uploadRef: { jobId: "job-1", name: "bg.png" } }, undefined),
                /assets bucket/
            );
        });

        it("resolves mainTypUploadRef by fetching the job upload from S3", async () => {
            const requested: Array<{ Bucket?: string; Key?: string }> = [];
            const s3 = fakeS3((command) => {
                requested.push((command as { input: { Bucket?: string; Key?: string } }).input);
                return s3BodyFromString("#set page(width: 100pt)\nFrom a presigned upload");
            });
            const result = await resolveMainTyp(
                { mainTypUploadRef: { jobId: "job-1", name: "main.typ" } },
                s3,
                ASSETS_BUCKET
            );
            try {
                const content = await readFile(result.mainPath, "utf-8");
                assert(content.includes("From a presigned upload"));
                assert.deepStrictEqual(requested, [{ Bucket: ASSETS_BUCKET, Key: "uploads/job-1/main.typ" }]);
            } finally {
                rmSync(result.workDir, { recursive: true, force: true });
            }
        });

        it("resolves an asset by uploadRef to its workDir filename", async () => {
            const b64 = Buffer.from("#hello").toString("base64");
            const s3 = fakeS3(() => s3BodyFromString("PNGDATA"));
            const result = await resolveMainTyp(
                {
                    mainTyp: b64,
                    assets: [{ name: "background.png", uploadRef: { jobId: "job-1", name: "bg-0.png" } }],
                },
                s3,
                ASSETS_BUCKET
            );
            try {
                // Typst resolves the image by workDir filename, not by the S3 key.
                const content = await readFile(`${result.workDir}/background.png`, "utf-8");
                assert.strictEqual(content, "PNGDATA");
            } finally {
                rmSync(result.workDir, { recursive: true, force: true });
            }
        });

        it("resolves data by uploadRef", async () => {
            const b64 = Buffer.from("#hello").toString("base64");
            const s3 = fakeS3(() => s3BodyFromString('{"from":"upload"}'));
            const result = await resolveMainTyp(
                {
                    mainTyp: b64,
                    data: { uploadRef: { jobId: "job-1", name: "rows.json" } },
                    dataFile: "data.json",
                },
                s3,
                ASSETS_BUCKET
            );
            try {
                const content = await readFile(`${result.workDir}/data.json`, "utf-8");
                assert.strictEqual(content, '{"from":"upload"}');
            } finally {
                rmSync(result.workDir, { recursive: true, force: true });
            }
        });

        it("reports a missing object as MissingInputError, not a raw NoSuchKey", async () => {
            const s3 = fakeS3(() => {
                const err = new Error("The specified key does not exist.");
                err.name = "NoSuchKey";
                throw err;
            });
            await assert.rejects(
                () => resolveMainTyp({ mainTypUploadRef: { jobId: "job-1", name: "main.typ" } }, s3, ASSETS_BUCKET),
                (err: Error) => {
                    assert(err instanceof MissingInputError);
                    assert(err.message.includes("uploads/job-1/main.typ"), err.message);
                    assert(err.message.includes("presigned upload"), err.message);
                    return true;
                }
            );
        });

        it("does not mask a non-404 S3 failure", async () => {
            const s3 = fakeS3(() => {
                const err = new Error("Access Denied");
                err.name = "AccessDenied";
                throw err;
            });
            await assert.rejects(
                () => resolveMainTyp({ mainTypUploadRef: { jobId: "job-1", name: "main.typ" } }, s3, ASSETS_BUCKET),
                /Access Denied/
            );
        });
    });
});
