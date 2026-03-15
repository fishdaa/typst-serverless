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

// --- Doc with assets (logo + data.json) ---

/** Path to doc-with-assets.typ fixture */
export const ASSETS_TYP_PATH = join(__fixturesDir, "doc-with-assets.typ");

/** Content of doc-with-assets.typ (requires logo.png + data.json in same dir) */
export const ASSETS_TYP_CONTENT = readFileSync(ASSETS_TYP_PATH, "utf-8");

/** Base64 doc-with-assets.typ */
export const ASSETS_TYP_B64 = Buffer.from(ASSETS_TYP_CONTENT, "utf-8").toString("base64");

/** Minimal 1x1 PNG (67 bytes) base64 */
export const PIXEL_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** data.json for doc-with-assets.typ */
export const ASSETS_DATA_JSON_OBJ = { title: "Assets Test", author: "typst-serverless", content: "Body content with embedded assets." };

/** Base64 data.json */
export const ASSETS_DATA_JSON_B64 = Buffer.from(
    JSON.stringify(ASSETS_DATA_JSON_OBJ),
    "utf-8"
).toString("base64");

/** Lambda/API compile event with assets and dataJson */
export const ASSETS_COMPILE_EVENT = {
    action: "compile" as const,
    mainTyp: ASSETS_TYP_B64,
    documentId: "assets-test",
    assets: [{ name: "logo.png", base64: PIXEL_PNG_B64 }],
    dataJson: ASSETS_DATA_JSON_B64,
};
