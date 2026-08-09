#!/usr/bin/env node
/**
 * Build Typst Lambda Layer.
 * Builds the typst CLI from source (fishdaa/typst fork, branch
 * optimize-large-png) targeting musl so it runs on Amazon Linux (Lambda),
 * then zips it up for a Lambda Layer.
 *
 * The layer only contains a native executable, so it can be attached to
 * Node.js, Go, or Rust Lambda functions. Build with LAMBDA_ARCH=x86_64 or
 * LAMBDA_ARCH=arm64 to make the binary match the function architecture.
 */
import { mkdir, rm, copyFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TYPST_REPO = process.env.TYPST_REPO || "https://github.com/fishdaa/typst.git";
const TYPST_REF = process.env.TYPST_REF || "optimize-large-png";
const LAMBDA_ARCH = process.env.LAMBDA_ARCH || "x86_64";
const targets = {
    x86_64: { platform: "linux/amd64", rust: "x86_64-unknown-linux-musl" },
    arm64: { platform: "linux/arm64", rust: "aarch64-unknown-linux-musl" },
};
if (!targets[LAMBDA_ARCH]) {
    throw new Error(`Unsupported LAMBDA_ARCH '${LAMBDA_ARCH}'. Use x86_64 or arm64.`);
}
// musl build works on Amazon Linux (Lambda), including provided.al2023
const BUILD_IMAGE = "rust:1-alpine";

const LAYER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "adapters", "lambda-layer", "layer");
const OUT_ZIP = join(
    dirname(LAYER_DIR),
    LAMBDA_ARCH === "x86_64" ? "typst-layer.zip" : `typst-layer-${LAMBDA_ARCH}.zip`,
);

async function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: "inherit", ...opts });
        p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    });
}

async function main() {
    console.log(`Building Typst Lambda Layer from ${TYPST_REPO}#${TYPST_REF}...`);
    const workDir = join(LAYER_DIR, "build");
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    // Build inside a musl-based container so the binary matches the Lambda
    // runtime regardless of the host OS/arch running this script.
    const buildScript = [
        "apk add --no-cache git musl-dev perl make",
        `git clone --depth 1 --branch ${TYPST_REF} ${TYPST_REPO} /typst-src`,
        "cd /typst-src",
        `rustup target add ${targets[LAMBDA_ARCH].rust}`,
        `cargo build --target ${targets[LAMBDA_ARCH].rust} --release --locked -p typst-cli --features vendor-openssl`,
        `cp target/${targets[LAMBDA_ARCH].rust}/release/typst /out/typst`,
    ].join(" && ");

    await run("docker", [
        "run", "--rm",
        "--platform", targets[LAMBDA_ARCH].platform,
        "-v", `${workDir}:/out`,
        BUILD_IMAGE,
        "sh", "-c", buildScript,
    ]);

    const optBin = join(LAYER_DIR, "bin");
    await mkdir(optBin, { recursive: true });
    const dest = join(optBin, "typst");
    await copyFile(join(workDir, "typst"), dest);
    await chmod(dest, 0o755);

    await rm(workDir, { recursive: true, force: true });

    console.log("Creating layer zip...");
    const zipDir = dirname(OUT_ZIP);
    await mkdir(zipDir, { recursive: true });
    // Lambda extracts a layer's zip contents directly into /opt, so the zip root
    // must contain "bin/typst" (not "opt/bin/typst") or the binary ends up at
    // the wrong path (/opt/opt/bin/typst) at runtime.
    await run("zip", ["-r", OUT_ZIP, "bin"], { cwd: LAYER_DIR });
    console.log("Layer built:", OUT_ZIP);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
