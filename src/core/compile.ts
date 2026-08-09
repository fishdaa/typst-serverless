/**
 * Platform-agnostic Typst compilation.
 * Spawns typst binary; used by container and Lambda adapters.
 * Supports PDF (including PDF/A variants), SVG, PNG output.
 */
import { spawn } from "node:child_process";
import { dirname, extname } from "node:path";
import { mkdirSync } from "node:fs";

/** Allowed format values for -f/--format */
const VALID_FORMATS = new Set<string>(["pdf", "png", "svg"]);
const VALID_PNG_COMPRESSION = new Set<string>([
    "no-compression", "fastest", "fast", "balanced", "high",
]);

/** Allowed PDF standards for --pdf-standard (PDF only) */
const VALID_PDF_STANDARDS = new Set<string>([
    "1.4", "1.5", "1.6", "1.7", "2.0",
    "a-1b", "a-2b", "a-3b", "a-4", "ua-1", "ua-2",
]);

export interface CompileOptions {
  root?: string;
  typstPath?: string;
  format?: string;
  pdfStandard?: string;
  /** Pixels per inch for PNG export (e.g. large-format posters). Typst default is 144. */
  ppi?: number;
  /** PNG compression effort. Defaults to high for smaller output files. */
  pngCompression?: string;
  /** Caps peak memory used while rendering a page to PNG, in mebibytes. Unset uses typst's built-in budget. */
  maxMemory?: number;
  /** Called with the spawned typst process's pid, e.g. so a caller can sample its RSS while it runs. */
  onSpawn?: (pid: number) => void;
}

function inferFormat(outputPath: string): string {
    const ext = (extname(outputPath) || "").toLowerCase().slice(1);
    return VALID_FORMATS.has(ext) ? ext : "pdf";
}

/**
 * Compile .typ source to PDF, SVG, or PNG.
 */
export async function compile(
    inputPath: string,
    outputPath: string,
    opts: CompileOptions = {}
): Promise<void> {
    const root = opts.root ?? dirname(inputPath);
    const typstPath = opts.typstPath ?? process.env.TYPST_PATH ?? "typst";
    const format = opts.format ?? inferFormat(outputPath);
    const pdfStandard = opts.pdfStandard;
    const pngCompression = opts.pngCompression ?? "high";

    const args = ["compile", "--root", root, "--font-path", root];
    if (VALID_FORMATS.has(format)) {
        args.push("-f", format);
    }
    if (pdfStandard && VALID_PDF_STANDARDS.has(String(pdfStandard).toLowerCase())) {
        args.push("--pdf-standard", String(pdfStandard).toLowerCase());
    }
    if (format === "png" && opts.ppi !== undefined && Number.isFinite(opts.ppi) && opts.ppi > 0) {
        args.push("--ppi", String(opts.ppi));
    }
    const hasPngCompression = format === "png" && VALID_PNG_COMPRESSION.has(pngCompression);
    const argsWithoutPngCompression = [...args];
    if (hasPngCompression) {
        args.push("--png-compression", pngCompression);
    }
    const hasMaxMemory = format === "png" && opts.maxMemory !== undefined && Number.isFinite(opts.maxMemory) && opts.maxMemory > 0;
    const argsWithoutMaxMemory = [...args];
    if (hasMaxMemory) {
        args.push("--max-memory", String(opts.maxMemory));
    }
    args.push(inputPath, outputPath);

    return new Promise((resolve, reject) => {
        mkdirSync(dirname(outputPath), { recursive: true });
        const run = (compileArgs: string[], canRetryPngOptions: boolean): void => {
            const proc = spawn(typstPath, compileArgs, { stdio: ["ignore", "pipe", "pipe"] });
            if (proc.pid !== undefined) opts.onSpawn?.(proc.pid);
            let stderr = "";
            proc.stderr?.on("data", (d: Buffer | string) => {
                stderr += d.toString();
            });
            proc.on("close", (code: number | null) => {
                if (code === 0) return resolve();

                // Older Typst binaries may not know the PNG options added by
                // the fork. Retry without only the unsupported option so the
                // otherwise compatible compiler remains usable.
                if (canRetryPngOptions && /unexpected argument ['"]?--max-memory/.test(stderr)) {
                    const retryArgs = [...argsWithoutMaxMemory, inputPath, outputPath];
                    return run(retryArgs, hasPngCompression);
                }
                if (canRetryPngOptions && /unexpected argument ['"]?--png-compression/.test(stderr)) {
                    const retryArgs = [...argsWithoutPngCompression, inputPath, outputPath];
                    return run(retryArgs, hasMaxMemory);
                }

                const err = new Error(
                    `Typst compile failed (${code}): ${stderr.trim() || "unknown"}`
                );
                (err as Error & { code?: number }).code = code ?? undefined;
                reject(err);
            });
            proc.on("error", reject);
        };

        run(args, hasMaxMemory || hasPngCompression);
    });
}
