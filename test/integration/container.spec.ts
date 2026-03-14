/**
 * Container integration tests.
 * Run: npm run test:integration (requires Docker)
 * Tests: docker run with volume, pipe modes; verify PDF output.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __testDir = dirname(fileURLToPath(import.meta.url));
import { tmpdir } from "node:os";

const IMAGE = "typst-serverless:test";
function docker(...args: string[]) {
    const { status, stdout, stderr } = spawnSync("docker", args, {
        encoding: "utf-8",
        timeout: 30000,
    });
    return { status, stdout, stderr };
}

describe("container integration (Docker)", () => {
    it("builds image successfully", { timeout: 150000 }, () => {
        const root = join(__testDir, "../..");
        const { status } = spawnSync("docker", ["build", "-t", IMAGE, "."], {
            cwd: root,
            encoding: "utf-8",
            timeout: 120000,
        });
        assert.strictEqual(status, 0, "Docker build should succeed");
    });

    it("volume mode: writes PDF to workspace", () => {
        const workDir = mkdtempSync(join(tmpdir(), "typst-vol-"));
        try {
            writeFileSync(join(workDir, "main.typ"), "#set page(width: 100pt)\nHello!");
            const { status } = docker(
                "run", "--rm",
                "-v", `${workDir}:/workspace`,
                "-e", "TYPST_WORKSPACE=/workspace",
                "-e", "TYPST_MAIN=main.typ",
                "-e", "TYPST_OUTPUT=output.pdf",
                IMAGE
            );
            assert.strictEqual(status, 0, "Container should exit 0");
            const outPath = join(workDir, "output.pdf");
            assert(existsSync(outPath), "output.pdf should exist in workspace");
            const buf = readFileSync(outPath);
            assert(buf.length > 0 && buf[0] === 0x25, "Output should be valid PDF");
        } finally {
            try { rmSync(workDir, { recursive: true, force: true }); } catch {}
        }
    });

    it("pipe mode: streams PDF to stdout", () => {
        const workDir = mkdtempSync(join(tmpdir(), "typst-pipe-"));
        try {
            writeFileSync(join(workDir, "main.typ"), "#set page(width: 80pt)\nPipe test");
            const { status } = spawnSync(
                "docker", [
                    "run", "--rm",
                    "-v", `${workDir}:/workspace`,
                    "-e", "TYPST_WORKSPACE=/workspace",
                    "-e", "TYPST_MAIN=main.typ",
                    "-e", "TYPST_PIPE=true",
                    IMAGE
                ],
                {
                    encoding: "utf-8",
                    stdio: ["ignore", "pipe", "pipe"],
                    timeout: 15000,
                }
            );
            assert.strictEqual(status, 0, "Pipe mode container runs");
        } finally {
            try { rmSync(workDir, { recursive: true, force: true }); } catch {}
        }
    });

    it("state mode: writes state file when enabled", () => {
        const workDir = mkdtempSync(join(tmpdir(), "typst-state-"));
        try {
            writeFileSync(join(workDir, "main.typ"), "#set page(width: 100pt)\nState test");
            const { status } = docker(
                "run", "--rm",
                "-v", `${workDir}:/workspace`,
                "-e", "TYPST_WORKSPACE=/workspace",
                "-e", "TYPST_MAIN=main.typ",
                "-e", "TYPST_OUTPUT=output.pdf",
                "-e", "TYPST_STATE=true",
                IMAGE
            );
            assert.strictEqual(status, 0, "Container should exit 0");
            const statePath = join(workDir, ".typst-state", "state.json");
            assert(existsSync(statePath), "State file should exist when TYPST_STATE=true");
        } finally {
            try { rmSync(workDir, { recursive: true, force: true }); } catch {}
        }
    });
});
