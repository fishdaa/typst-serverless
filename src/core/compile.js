/**
 * Platform-agnostic Typst compilation.
 * Spawns typst binary; used by container and Lambda adapters.
 */
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Compile .typ source to PDF.
 * @param {string} inputPath - Path to main.typ
 * @param {string} outputPath - Path for output PDF
 * @param {object} [opts] - Options (root dir for imports, etc.)
 * @returns {Promise<void>}
 */
export async function compile(inputPath, outputPath, opts = {}) {
  const root = opts.root ?? dirname(inputPath);
  const typstPath = opts.typstPath ?? "typst";
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(outputPath), { recursive: true });
    const proc = spawn(
      typstPath,
      ["compile", "--root", root, inputPath, outputPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      const err = new Error(`Typst compile failed (${code}): ${stderr.trim() || "unknown"}`);
      err.code = code;
      reject(err);
    });
    proc.on("error", reject);
  });
}
