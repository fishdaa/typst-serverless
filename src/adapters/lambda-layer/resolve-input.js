/**
 * Resolve main.typ content from event (base64 or S3).
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * @param {object} event - { mainTyp?: string, mainTypS3?: { bucket, key } }
 * @param {object} s3Client - AWS S3 client
 * @returns {Promise<{ workDir: string; mainPath: string }>}
 */
export async function resolveMainTyp(event, s3Client) {
  const workDir = join(tmpdir(), `typst-${randomUUID()}`);

  if (event.mainTyp) {
    const content = Buffer.from(event.mainTyp, "base64").toString("utf-8");
    const mainPath = join(workDir, "main.typ");
    await mkdir(workDir, { recursive: true });
    await writeFile(mainPath, content, "utf-8");
    return { workDir, mainPath };
  }

  if (event.mainTypS3) {
    const { bucket, key } = event.mainTypS3;
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const content = await streamToString(Body);
    const mainPath = join(workDir, "main.typ");
    await mkdir(workDir, { recursive: true });
    await writeFile(mainPath, content, "utf-8");
    return { workDir, mainPath };
  }

  throw new Error("mainTyp or mainTypS3 required");
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}
