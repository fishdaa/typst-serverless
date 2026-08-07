/**
 * resolve-input.ts unit tests (error branches).
 * Happy paths are exercised indirectly via lambda.spec.ts / localstack.spec.ts;
 * this covers missing-source, malformed-data, and S3 failure branches directly.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveMainTyp } from "@/adapters/lambda-layer/resolve-input.js";
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
            /mainTyp or mainTypS3 required/
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
            /Asset needs bucket\+key or base64/
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
            /data must be base64 string or \{ bucket, key \}/
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
});
