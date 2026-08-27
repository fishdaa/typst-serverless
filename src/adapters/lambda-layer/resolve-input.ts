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
import { validateDataFile } from "@/core/validate.js";

interface ContentSource {
  bucket?: string;
  key?: string;
  base64?: string;
}

/** Prefix under which cached assets live in the assets bucket. */
export const ASSET_PREFIX = "assets/";

/**
 * Prefix under which ephemeral, job-scoped presigned uploads live. Unlike
 * ASSET_PREFIX these are lifecycle-expired, so a one-off compile input does not
 * accumulate in the curated asset library.
 */
export const UPLOAD_PREFIX = "uploads/";

/** S3 key for an ephemeral job upload. */
export function uploadKeyFor(jobId: string, name: string): string {
    return `${UPLOAD_PREFIX}${jobId}/${name}`;
}

/** S3 key for a cached asset-library object. */
export function assetKeyFor(assetPath: string): string {
    return `${ASSET_PREFIX}${assetPath}`;
}

export interface UploadRef {
  jobId: string;
  name: string;
}

interface AssetPathRef {
  bucket?: string;
  key?: string;
  base64?: string;
  assetPath?: string;
  uploadRef?: UploadRef;
}

/**
 * Resolves an item that may reference a cached asset by path or a job upload by
 * { jobId, name } into a plain bucket/key/base64 source.
 */
export function resolveContentSource(item: AssetPathRef, assetsBucket: string | undefined): ContentSource {
    if (item.assetPath) {
        if (!assetsBucket) {
            throw new Error("assetPath requires an assets bucket (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)");
        }
        return { bucket: assetsBucket, key: assetKeyFor(item.assetPath) };
    }
    if (item.uploadRef?.jobId && item.uploadRef?.name) {
        if (!assetsBucket) {
            throw new Error("uploadRef requires an assets bucket (TYPST_ASSETS_BUCKET or TYPST_INPUT_BUCKET)");
        }
        return { bucket: assetsBucket, key: uploadKeyFor(item.uploadRef.jobId, item.uploadRef.name) };
    }
    if (item.bucket && item.key) return { bucket: item.bucket, key: item.key };
    return { base64: item.base64 };
}

/** Thrown when referenced input objects are absent from S3 (e.g. a presigned upload never completed). */
export class MissingInputError extends Error {
    readonly keys: string[];
    constructor(bucket: string, keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys];
        const rendered = list.map((k) => `s3://${bucket}/${k}`).join(", ");
        super(`Input not found in S3: ${rendered} — the presigned upload may not have completed`);
        this.name = "MissingInputError";
        this.keys = list;
    }
}

function isNotFound(err: unknown): boolean {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/** GetObject with the not-found case mapped to a client-actionable error. */
async function getObjectBody(s3Client: S3Client, bucket: string, key: string) {
    try {
        return await withRetry<GetObjectCommandOutput>(() =>
            s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        );
    } catch (err) {
        if (isNotFound(err)) throw new MissingInputError(bucket, key);
        throw err;
    }
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
    const { bucket, key } = contentSource;
    if (bucket && key) {
        const { Body } = await getObjectBody(s3Client, bucket, key);
        const chunks: Uint8Array[] = [];
        if (Body) {
            const stream = Body as AsyncIterable<Uint8Array>;
            for await (const chunk of stream) chunks.push(chunk);
        }
        await writeFile(destPath, Buffer.concat(chunks));
    } else if (contentSource.base64) {
        await writeFile(destPath, Buffer.from(contentSource.base64, "base64"));
    } else {
        throw new Error("Asset needs bucket+key, assetPath, uploadRef, or base64");
    }
}

interface AssetItem {
  name: string;
  bucket?: string;
  key?: string;
  base64?: string;
  assetPath?: string;
  uploadRef?: UploadRef;
}

async function resolveFontsAndAssets(
    items: AssetItem[],
    workDir: string,
    s3Client: S3Client,
    assetsBucket: string | undefined
): Promise<void> {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
        const destPath = join(workDir, item.name);
        const contentSource = resolveContentSource(item, assetsBucket);
        await resolveFile(contentSource, destPath, s3Client);
    }
}

/** Extra .typ source: name = path relative to workDir (e.g. lib/module.typ) */
interface ExtraTypItem {
    name: string;
    base64?: string;
    bucket?: string;
    key?: string;
    assetPath?: string;
    uploadRef?: UploadRef;
}

async function resolveExtraTyps(
    items: ExtraTypItem[],
    workDir: string,
    s3Client: S3Client,
    assetsBucket: string | undefined
): Promise<void> {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
        const destPath = join(workDir, item.name);
        const contentSource = resolveContentSource(item, assetsBucket);
        await resolveFile(contentSource, destPath, s3Client);
    }
}

export interface ResolveResult {
  workDir: string;
  mainPath: string;
}

async function resolveData(
    data: unknown,
    dataFile: string,
    workDir: string,
    s3Client: S3Client,
    assetsBucket: string | undefined
): Promise<void> {
    if (!data) return;
    const fileResult = validateDataFile(dataFile);
    if (!fileResult.valid) throw new Error(fileResult.error);
    const dataPath = join(workDir, dataFile);
    if (typeof data === "string") {
        await writeFile(dataPath, Buffer.from(data, "base64"));
        return;
    }
    if (
        typeof data === "object" && data !== null &&
        ("bucket" in data && "key" in data || "assetPath" in data || "uploadRef" in data)
    ) {
        const ref = data as { bucket?: string; key?: string; assetPath?: string; uploadRef?: UploadRef };
        const src = resolveContentSource(ref, assetsBucket);
        if (!src.bucket || !src.key) {
            throw new Error("data must be base64 string, { bucket, key }, { assetPath }, or { uploadRef }");
        }
        const { Body } = await getObjectBody(s3Client, src.bucket, src.key);
        const chunks: Uint8Array[] = [];
        if (Body) {
            const stream = Body as AsyncIterable<Uint8Array>;
            for await (const chunk of stream) chunks.push(chunk);
        }
        await writeFile(dataPath, Buffer.concat(chunks));
        return;
    }
    throw new Error("data must be base64 string, { bucket, key }, { assetPath }, or { uploadRef }");
}

function getMainFilename(event: Record<string, unknown>): string {
    const m = event.main;
    if (m && typeof m === "string" && m.length > 0 && m.toLowerCase().endsWith(".typ")) {
        return m;
    }
    return "main.typ";
}

export async function resolveMainTyp(
    event: Record<string, unknown>,
    s3Client: S3Client,
    assetsBucket?: string
): Promise<ResolveResult> {
    const workDir = join(tmpdir(), `typst-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    const mainFilename = getMainFilename(event);

    const resolveRest = async (): Promise<void> => {
        await resolveFontsAndAssets((event.fonts as AssetItem[]) || [], workDir, s3Client, assetsBucket);
        await resolveFontsAndAssets((event.assets as AssetItem[]) || [], workDir, s3Client, assetsBucket);
        await resolveExtraTyps((event.extraTyps as ExtraTypItem[]) || [], workDir, s3Client, assetsBucket);
        await resolveData(event.data, (event.dataFile as string) ?? "data.json", workDir, s3Client, assetsBucket);
    };

    if (event.mainTyp && typeof event.mainTyp === "string") {
        const content = Buffer.from(event.mainTyp, "base64").toString("utf-8");
        const mainPath = join(workDir, mainFilename);
        await writeFile(mainPath, content, "utf-8");
        await resolveRest();
        return { workDir, mainPath };
    }

    if (
        (event.mainTypS3 && typeof event.mainTypS3 === "object") ||
        typeof event.mainTypAssetPath === "string" ||
        (event.mainTypUploadRef && typeof event.mainTypUploadRef === "object")
    ) {
        const ref = (event.mainTypS3 as { bucket?: string; key?: string } | undefined) || {};
        const src = resolveContentSource({
            ...ref,
            assetPath: event.mainTypAssetPath as string | undefined,
            uploadRef: event.mainTypUploadRef as UploadRef | undefined,
        }, assetsBucket);
        if (!src.bucket || !src.key) throw new Error("mainTypS3 must be { bucket, key }");
        const { Body } = await getObjectBody(s3Client, src.bucket, src.key);
        const content = Body ? await streamToString(Body as AsyncIterable<Uint8Array>) : "";
        const mainPath = join(workDir, mainFilename);
        await writeFile(mainPath, content, "utf-8");
        await resolveRest();
        return { workDir, mainPath };
    }

    throw new Error("mainTyp, mainTypS3, mainTypAssetPath, or mainTypUploadRef required");
}
