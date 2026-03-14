/**
 * Resolve main.typ, fonts, and assets from event (base64 or S3).
 * Uses withRetry for S3 operations (chaos engineering resilience).
 */
import { Buffer } from "node:buffer";
import { GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { withRetry } from "@/core/chaos.js";

interface ContentSource {
  bucket?: string;
  key?: string;
  base64?: string;
}

async function streamToString(stream: unknown): Promise<string> {
    const chunks: Uint8Array[] = [];
    const it = stream as AsyncIterable<Uint8Array>;
    for await (const chunk of it) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf-8");
}

async function resolveFile(
    contentSource: ContentSource,
    destPath: string,
    s3Client: S3Client
): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true });
    if (contentSource.bucket && contentSource.key) {
        const { Body } = await withRetry<GetObjectCommandOutput>(() =>
            s3Client.send(new GetObjectCommand({ Bucket: contentSource.bucket!, Key: contentSource.key! }))
        );
        const chunks: Uint8Array[] = [];
        if (Body) {
            const stream = Body as AsyncIterable<Uint8Array>;
            for await (const chunk of stream) chunks.push(chunk);
        }
        await writeFile(destPath, Buffer.concat(chunks));
    } else if (contentSource.base64) {
        await writeFile(destPath, Buffer.from(contentSource.base64, "base64"));
    } else {
        throw new Error("Asset needs bucket+key or base64");
    }
}

interface AssetItem {
  name: string;
  bucket?: string;
  key?: string;
  base64?: string;
}

async function resolveFontsAndAssets(
    items: AssetItem[],
    workDir: string,
    s3Client: S3Client
): Promise<void> {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
        const destPath = join(workDir, item.name);
        const contentSource: ContentSource =
      item.bucket && item.key ? { bucket: item.bucket, key: item.key } : { base64: item.base64 };
        await resolveFile(contentSource, destPath, s3Client);
    }
}

export interface ResolveResult {
  workDir: string;
  mainPath: string;
}

async function resolveDataJson(
    dataJson: unknown,
    workDir: string,
    s3Client: S3Client
): Promise<void> {
    if (!dataJson) return;
    const dataPath = join(workDir, "data.json");
    if (typeof dataJson === "string") {
        const content = Buffer.from(dataJson, "base64").toString("utf-8");
        await writeFile(dataPath, content, "utf-8");
        return;
    }
    if (typeof dataJson === "object" && dataJson !== null && "bucket" in dataJson && "key" in dataJson) {
        const ref = dataJson as { bucket: string; key: string };
        const { Body } = await withRetry<GetObjectCommandOutput>(() =>
            s3Client.send(new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }))
        );
        const content = Body ? await streamToString(Body as AsyncIterable<Uint8Array>) : "{}";
        await writeFile(dataPath, content, "utf-8");
        return;
    }
    throw new Error("dataJson must be base64 string or { bucket, key }");
}

export async function resolveMainTyp(
    event: Record<string, unknown>,
    s3Client: S3Client
): Promise<ResolveResult> {
    const workDir = join(tmpdir(), `typst-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    if (event.mainTyp && typeof event.mainTyp === "string") {
        const content = Buffer.from(event.mainTyp, "base64").toString("utf-8");
        const mainPath = join(workDir, "main.typ");
        await writeFile(mainPath, content, "utf-8");
        await resolveFontsAndAssets((event.fonts as AssetItem[]) || [], workDir, s3Client);
        await resolveFontsAndAssets((event.assets as AssetItem[]) || [], workDir, s3Client);
        await resolveDataJson(event.dataJson, workDir, s3Client);
        return { workDir, mainPath };
    }

    if (event.mainTypS3 && typeof event.mainTypS3 === "object") {
        const ref = event.mainTypS3 as { bucket: string; key: string };
        const { bucket, key } = ref;
        const { Body } = await withRetry<GetObjectCommandOutput>(() =>
            s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        );
        const content = Body ? await streamToString(Body as AsyncIterable<Uint8Array>) : "";
        const mainPath = join(workDir, "main.typ");
        await writeFile(mainPath, content, "utf-8");
        await resolveFontsAndAssets((event.fonts as AssetItem[]) || [], workDir, s3Client);
        await resolveFontsAndAssets((event.assets as AssetItem[]) || [], workDir, s3Client);
        await resolveDataJson(event.dataJson, workDir, s3Client);
        return { workDir, mainPath };
    }

    throw new Error("mainTyp or mainTypS3 required");
}
