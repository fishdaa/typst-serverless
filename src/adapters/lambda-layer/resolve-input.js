/**
 * Resolve main.typ, fonts, and assets from event (base64 or S3).
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function resolveFile(contentSource, destPath, s3Client) {
  await mkdir(dirname(destPath), { recursive: true });
  if (contentSource.bucket && contentSource.key) {
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: contentSource.bucket, Key: contentSource.key })
    );
    const chunks = [];
    for await (const chunk of Body) chunks.push(chunk);
    await writeFile(destPath, Buffer.concat(chunks));
  } else if (contentSource.base64) {
    await writeFile(destPath, Buffer.from(contentSource.base64, "base64"));
  } else {
    throw new Error("Asset needs bucket+key or base64");
  }
}

/**
 * Resolve fonts and assets to workDir.
 * @param {Array} items - [{ name, bucket?, key?, base64? }]
 * @param {string} workDir
 * @param {object} s3Client
 */
async function resolveFontsAndAssets(items, workDir, s3Client) {
  if (!items || !Array.isArray(items) || items.length === 0) return;
  for (const item of items) {
    const destPath = join(workDir, item.name);
    const contentSource = item.bucket && item.key
      ? { bucket: item.bucket, key: item.key }
      : { base64: item.base64 };
    await resolveFile(contentSource, destPath, s3Client);
  }
}

/**
 * @param {object} event - { mainTyp?, mainTypS3?, fonts?, assets? }
 * @param {object} s3Client - AWS S3 client
 * @returns {Promise<{ workDir: string; mainPath: string }>}
 */
export async function resolveMainTyp(event, s3Client) {
  const workDir = join(tmpdir(), `typst-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  if (event.mainTyp) {
    const content = Buffer.from(event.mainTyp, "base64").toString("utf-8");
    const mainPath = join(workDir, "main.typ");
    await writeFile(mainPath, content, "utf-8");
    await resolveFontsAndAssets(event.fonts || [], workDir, s3Client);
    await resolveFontsAndAssets(event.assets || [], workDir, s3Client);
    return { workDir, mainPath };
  }

  if (event.mainTypS3) {
    const { bucket, key } = event.mainTypS3;
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const content = await streamToString(Body);
    const mainPath = join(workDir, "main.typ");
    await writeFile(mainPath, content, "utf-8");
    await resolveFontsAndAssets(event.fonts || [], workDir, s3Client);
    await resolveFontsAndAssets(event.assets || [], workDir, s3Client);
    return { workDir, mainPath };
  }

  throw new Error("mainTyp or mainTypS3 required");
}
