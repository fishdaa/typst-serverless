/**
 * Rollup config for Lambda handler bundle.
 * Bundles handler + core + AWS SDK into a single ESM file.
 * Run after: npm run build (tsc → dist/)
 */
import { defineConfig } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

export default defineConfig({
    input: "dist/adapters/lambda-layer/index.js",
    output: {
        file: "dist-lambda/adapters/lambda-layer/index.js",
        format: "esm",
        exports: "named",
        inlineDynamicImports: true,
    },
    plugins: [
        json(),
        nodeResolve({ preferBuiltins: true }),
        commonjs(),
    ],
    external: [
        "node:fs",
        "node:path",
        "node:crypto",
        "node:https",
        "node:http",
        "node:child_process",
    ],
});
