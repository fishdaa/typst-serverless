/**
 * Asset validation tests (Phase 3).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import {
    validateAssetKey,
    validateAssetRef,
    validateAssets,
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_FONT_EXTENSIONS,
} from "@/core/assets.js";

describe("assets validation", () => {
    describe("validateAssetKey", () => {
        it("accepts valid image keys", () => {
            for (const ext of ALLOWED_IMAGE_EXTENSIONS) {
                const r = validateAssetKey(`path/image${ext}`, "image");
                assert.strictEqual(r.valid, true, `expected ${ext} to be valid`);
            }
        });

        it("accepts valid font keys", () => {
            for (const ext of ALLOWED_FONT_EXTENSIONS) {
                const r = validateAssetKey(`fonts/custom${ext}`, "font");
                assert.strictEqual(r.valid, true, `expected ${ext} to be valid`);
            }
        });

        it("rejects unsupported image extension", () => {
            const r = validateAssetKey("logo.bmp", "image");
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("allowed extension"));
        });

        it("rejects unsupported font extension", () => {
            const r = validateAssetKey("font.woff", "font");
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("allowed extension"));
        });

        it("rejects path traversal in key", () => {
            const r = validateAssetKey("../etc/image.png", "image");
            assert.strictEqual(r.valid, false);
        });

        it("rejects empty key", () => {
            const r = validateAssetKey("", "image");
            assert.strictEqual(r.valid, false);
        });
    });

    describe("validateAssetRef", () => {
        it("accepts valid S3 ref", () => {
            const r = validateAssetRef({ bucket: "b", key: "img/logo.png" }, "image");
            assert.strictEqual(r.valid, true);
        });

        it("rejects missing bucket", () => {
            const r = validateAssetRef({ key: "logo.png" } as { bucket: string; key: string }, "image");
            assert.strictEqual(r.valid, false);
        });

        it("rejects invalid key extension", () => {
            const r = validateAssetRef({ bucket: "b", key: "logo.xyz" }, "image");
            assert.strictEqual(r.valid, false);
        });
    });

    describe("validateAssets", () => {
        it("accepts empty or undefined assets", () => {
            assert.strictEqual(validateAssets(undefined).valid, true);
            assert.strictEqual(validateAssets([]).valid, true);
        });

        it("accepts valid assets with bucket+key", () => {
            const r = validateAssets(
                [{ name: "logo.png", bucket: "b", key: "assets/logo.png" }],
                "image"
            );
            assert.strictEqual(r.valid, true);
        });

        it("accepts valid assets with base64", () => {
            const r = validateAssets(
                [{ name: "img.png", base64: "iVBORw0KGgo=" }],
                "image"
            );
            assert.strictEqual(r.valid, true);
        });

        it("rejects asset without name", () => {
            const r = validateAssets([{ bucket: "b", key: "x.png" }] as never, "image");
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("name"));
        });

        it("rejects asset with invalid name (path traversal)", () => {
            const r = validateAssets(
                [{ name: "../bad.png", bucket: "b", key: "x.png" }],
                "image"
            );
            assert.strictEqual(r.valid, false);
        });

        it("rejects asset with invalid extension", () => {
            const r = validateAssets(
                [{ name: "logo.bmp", bucket: "b", key: "x.bmp" }],
                "image"
            );
            assert.strictEqual(r.valid, false);
        });

        it("rejects asset without bucket+key or base64", () => {
            const r = validateAssets([{ name: "x.png" }], "image");
            assert.strictEqual(r.valid, false);
            assert(r.error?.includes("bucket+key") || r.error?.includes("base64"));
        });

        it("accepts multiple image formats (PNG, JPEG, GIF, WebP, SVG)", () => {
            const formats = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
            for (const ext of formats) {
                const r = validateAssets(
                    [{ name: `image${ext}`, base64: "iVBORw0KGgo=" }],
                    "image"
                );
                assert.strictEqual(r.valid, true, `expected ${ext} to be valid`);
            }
        });

        it("accepts font formats (OTF, TTF, TTC)", () => {
            const formats = [".otf", ".ttf", ".ttc"];
            for (const ext of formats) {
                const r = validateAssets(
                    [{ name: `font${ext}`, base64: "dGVzdA==" }],
                    "font"
                );
                assert.strictEqual(r.valid, true, `expected ${ext} to be valid`);
            }
        });

        it("accepts assets with S3 ref for image and font", () => {
            const img = validateAssets(
                [{ name: "logo.png", bucket: "b", key: "assets/logo.png" }],
                "image"
            );
            const font = validateAssets(
                [{ name: "custom.otf", bucket: "b", key: "fonts/custom.otf" }],
                "font"
            );
            assert.strictEqual(img.valid, true);
            assert.strictEqual(font.valid, true);
        });
    });
});
