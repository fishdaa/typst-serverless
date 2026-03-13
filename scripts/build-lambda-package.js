#!/usr/bin/env node
/**
 * Build Lambda deployment package.
 * Uses Rollup to bundle handler + core + AWS SDK into a single file.
 * Outputs to dist-lambda/ (no node_modules).
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-lambda");

async function main() {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    execSync("npx rollup -c rollup.config.lambda.js", { cwd: root, stdio: "inherit" });

    await writeFile(
        join(outDir, "package.json"),
        JSON.stringify({ type: "module" }, null, 2)
    );

    console.log("Lambda package built:", outDir);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
