/**
 * Shared cross-adapter fixtures (Phase 6.6).
 * Canonical payloads used by core, Lambda, and API tests.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __fixturesDir = join(dirname(fileURLToPath(import.meta.url)));

/** Minimal Typst content for cross-adapter tests */
export const CROSS_ADAPTER_TYP = "#set page(width: 100pt)\nHello, cross-adapter!";

/** Base64-encoded CROSS_ADAPTER_TYP */
export const CROSS_ADAPTER_B64 = Buffer.from(CROSS_ADAPTER_TYP, "utf-8").toString("base64");

/** Lambda/API compile event for cross-adapter tests */
export const CROSS_ADAPTER_COMPILE_EVENT = {
    action: "compile" as const,
    mainTyp: CROSS_ADAPTER_B64,
    documentId: "cross-adapter-test",
};

/** Path to minimal.typ fixture */
export const MINIMAL_TYP_PATH = join(__fixturesDir, "minimal.typ");

/** Content of minimal.typ */
export const MINIMAL_TYP_CONTENT = readFileSync(MINIMAL_TYP_PATH, "utf-8");

/** Base64 minimal.typ for inline payloads */
export const MINIMAL_B64 = Buffer.from(MINIMAL_TYP_CONTENT, "utf-8").toString("base64");
