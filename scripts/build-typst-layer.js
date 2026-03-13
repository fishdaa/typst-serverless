#!/usr/bin/env node
/**
 * Build Typst Lambda Layer.
 * Downloads typst-x86_64-unknown-linux-gnu from GitHub releases,
 * extracts to opt/bin, zips for Lambda Layer.
 */
import { mkdir, readdir, chmod, rm, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TYPST_VERSION = "0.14.2";
// musl build works on Amazon Linux (Lambda)
const URL = `https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz`;
const LAYER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "adapters", "lambda-layer", "layer");
const OUT_ZIP = join(dirname(LAYER_DIR), "typst-layer.zip");

async function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: "inherit", ...opts });
        p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    });
}

async function main() {
    console.log("Building Typst Lambda Layer...");
    const workDir = join(LAYER_DIR, "build");
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    const tarPath = join(workDir, "typst.tar.xz");
    console.log("Downloading", URL);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    await pipeline(res.body, createWriteStream(tarPath));

    const extractDir = join(workDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await run("tar", ["-xJf", tarPath, "-C", extractDir]);

    const findTypstBin = async (dir) => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isFile() && e.name === "typst") return p;
            if (e.isDirectory() && !e.name.startsWith(".")) {
                const found = await findTypstBin(p);
                if (found) return found;
            }
        }
        return null;
    };
    const binPath = await findTypstBin(extractDir);
    if (!binPath) throw new Error("typst binary not found in archive");

    const optBin = join(LAYER_DIR, "opt", "bin");
    await mkdir(optBin, { recursive: true });
    const dest = join(optBin, "typst");
    await copyFile(binPath, dest);
    await chmod(dest, 0o755);

    await rm(workDir, { recursive: true, force: true });

    console.log("Creating layer zip...");
    const zipDir = dirname(OUT_ZIP);
    await mkdir(zipDir, { recursive: true });
    await run("zip", ["-r", OUT_ZIP, "opt"], { cwd: LAYER_DIR });
    console.log("Layer built:", OUT_ZIP);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
