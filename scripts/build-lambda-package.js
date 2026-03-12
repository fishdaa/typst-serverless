#!/usr/bin/env node
/**
 * Build Lambda deployment package.
 * Outputs to dist-lambda/ with handler, core, and node_modules.
 */
import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-lambda");

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Copy handler and core
  await mkdir(join(outDir, "adapters/lambda-layer"), { recursive: true });
  await mkdir(join(outDir, "core"), { recursive: true });
  await cp(join(root, "src/adapters/lambda-layer/index.js"), join(outDir, "adapters/lambda-layer/index.js"));
  await cp(join(root, "src/adapters/lambda-layer/handler.js"), join(outDir, "adapters/lambda-layer/handler.js"));
  await cp(join(root, "src/adapters/lambda-layer/api-handler.js"), join(outDir, "adapters/lambda-layer/api-handler.js"));
  await cp(join(root, "src/adapters/lambda-layer/resolve-input.js"), join(outDir, "adapters/lambda-layer/resolve-input.js"));
  await cp(join(root, "src/core/compile.js"), join(outDir, "core/compile.js"));
  await cp(join(root, "src/core/state.js"), join(outDir, "core/state.js"));
  await cp(join(root, "src/core/validate.js"), join(outDir, "core/validate.js"));
  await cp(join(root, "src/core/assets.js"), join(outDir, "core/assets.js"));

  // Minimal package.json for Lambda
  await writeFile(
    join(outDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2)
  );

  // Install only AWS SDK deps
  execSync("npm install @aws-sdk/client-dynamodb @aws-sdk/client-s3 @aws-sdk/lib-dynamodb @aws-sdk/s3-request-presigner --omit=dev", {
    cwd: outDir,
    stdio: "inherit",
  });

  console.log("Lambda package built:", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
