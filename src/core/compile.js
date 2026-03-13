/**
 * Platform-agnostic Typst compilation.
 * Spawns typst binary; used by container and Lambda adapters.
 * Supports PDF (including PDF/A variants), SVG, PNG output.
 */
import { spawn } from "node:child_process";
import { dirname, extname } from "node:path";
import { mkdirSync } from "node:fs";

/** Allowed format values for -f/--format */
const VALID_FORMATS = new Set(["pdf", "png", "svg"]);

/** Allowed PDF standards for --pdf-standard (PDF only) */
const VALID_PDF_STANDARDS = new Set(["1.4", "1.5", "1.6", "1.7", "2.0", "a-1b", "a-2b", "a-3b", "a-4", "ua-1", "ua-2"]);

function inferFormat(outputPath) {
  const ext = (extname(outputPath) || "").toLowerCase().slice(1);
  return VALID_FORMATS.has(ext) ? ext : "pdf";
}

/**
 * Compile .typ source to PDF, SVG, or PNG.
 * @param {string} inputPath - Path to main.typ
 * @param {string} outputPath - Path for output file
 * @param {object} [opts] - Options (root, typstPath, format, pdfStandard)
 * @returns {Promise<void>}
 */
export async function compile(inputPath, outputPath, opts = {}) {
  const root = opts.root ?? dirname(inputPath);
  const typstPath = opts.typstPath ?? "typst";
  const format = opts.format ?? inferFormat(outputPath);
  const pdfStandard = opts.pdfStandard;

  const args = ["compile", "--root", root];
  if (VALID_FORMATS.has(format)) {
    args.push("-f", format);
  }
  if (pdfStandard && VALID_PDF_STANDARDS.has(String(pdfStandard).toLowerCase())) {
    args.push("--pdf-standard", String(pdfStandard).toLowerCase());
  }
  args.push(inputPath, outputPath);

  return new Promise((resolve, reject) => {
    mkdirSync(dirname(outputPath), { recursive: true });
    const proc = spawn(typstPath, args, { stdio: ["ignore", "pipe", "pipe"] });
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
