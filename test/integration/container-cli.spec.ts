/**
 * Container CLI (src/adapters/container/cli.ts) direct-invocation tests.
 * container.spec.ts exercises the built Docker image end-to-end (success paths only,
 * requires Docker). This runs the built CLI directly via `node` (no Docker) to cover
 * its failure branch: a compile error with TYPST_STATE=true must exit 1 and write
 * status "failed" (with an error message) to state.json.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { assertTypst } from "../test-output-helper.js";

const __testDir = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__testDir, "../../dist/adapters/container/cli.js");
const INVALID_TYP_FIXTURE = join(__testDir, "../fixtures/invalid-syntax.typ");

function runCli(workDir: string, env: Record<string, string>) {
    return spawnSync("node", [CLI_PATH], {
        env: { ...process.env, TYPST_WORKSPACE: workDir, ...env },
        encoding: "utf-8",
        timeout: 15000,
    });
}

describe("container CLI (direct node invocation)", () => {
    it("exits 1 and writes a failed state entry on compile error", () => {
        assertTypst();
        assert(existsSync(CLI_PATH), "dist build must exist (run `npm run build` first)");
        const workDir = mkdtempSync(join(tmpdir(), "typst-cli-fail-"));
        try {
            copyFileSync(INVALID_TYP_FIXTURE, join(workDir, "main.typ"));
            const { status, stderr } = runCli(workDir, {
                TYPST_MAIN: "main.typ",
                TYPST_OUTPUT: "output.pdf",
                TYPST_STATE: "true",
            });

            assert.strictEqual(status, 1, "CLI should exit 1 on compile failure");
            assert(stderr.length > 0, "stderr should contain the compile error");

            const statePath = join(workDir, ".typst-state", "state.json");
            assert(existsSync(statePath), "state.json should be written even on failure");
            const state = JSON.parse(readFileSync(statePath, "utf-8"));
            const entries = Object.values(state) as Array<{ status: string; error?: string }>;
            assert.strictEqual(entries.length, 1);
            assert.strictEqual(entries[0].status, "failed");
            assert(entries[0].error && entries[0].error.length > 0, "failed entry should include an error message");

            assert(!existsSync(join(workDir, "output.pdf")), "no output.pdf should be produced on failure");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    it("does not write a state file when TYPST_STATE is unset, even on failure", () => {
        assertTypst();
        assert(existsSync(CLI_PATH), "dist build must exist (run `npm run build` first)");
        const workDir = mkdtempSync(join(tmpdir(), "typst-cli-fail-nostate-"));
        try {
            copyFileSync(INVALID_TYP_FIXTURE, join(workDir, "main.typ"));
            const { status } = runCli(workDir, {
                TYPST_MAIN: "main.typ",
                TYPST_OUTPUT: "output.pdf",
            });

            assert.strictEqual(status, 1, "CLI should exit 1 on compile failure");
            assert(!existsSync(join(workDir, ".typst-state")), "no state dir should be created");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    it("exits 0 and writes a completed state entry on success", () => {
        assertTypst();
        assert(existsSync(CLI_PATH), "dist build must exist (run `npm run build` first)");
        const workDir = mkdtempSync(join(tmpdir(), "typst-cli-ok-"));
        try {
            writeFileSync(join(workDir, "main.typ"), "#set page(width: 100pt)\nCLI direct test");
            const { status } = runCli(workDir, {
                TYPST_MAIN: "main.typ",
                TYPST_OUTPUT: "output.pdf",
                TYPST_STATE: "true",
            });

            assert.strictEqual(status, 0, "CLI should exit 0 on success");
            const statePath = join(workDir, ".typst-state", "state.json");
            const state = JSON.parse(readFileSync(statePath, "utf-8"));
            const entries = Object.values(state) as Array<{ status: string }>;
            assert.strictEqual(entries[0].status, "completed");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});
