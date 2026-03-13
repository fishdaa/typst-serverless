/**
 * Asset validation for fonts and images.
 * Typst-supported formats only: PNG, JPEG, GIF, WebP, SVG for images;
 * OTF, TTF, TTC for fonts.
 */
import { validateS3Key } from "./validate.js";

/** Allowed image extensions (lowercase) */
export const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];

/** Allowed font extensions (Typst supports OTF, TTF, TTC) */
export const ALLOWED_FONT_EXTENSIONS = [".otf", ".ttf", ".ttc"];

type AssetType = "image" | "font";

function getExtension(key: string | null | undefined): string | null {
  if (!key || typeof key !== "string") return null;
  const idx = key.lastIndexOf(".");
  if (idx < 0 || idx === key.length - 1) return null;
  return key.slice(idx).toLowerCase();
}

/**
 * Validate asset key: allowed type and no path traversal.
 */
export function validateAssetKey(key: string | null | undefined, type: AssetType = "image") {
  const keyResult = validateS3Key(key);
  if (!keyResult.valid) return keyResult;
  const ext = getExtension(key);
  const allowed = type === "image" ? ALLOWED_IMAGE_EXTENSIONS : ALLOWED_FONT_EXTENSIONS;
  if (!ext || !allowed.includes(ext)) {
    return {
      valid: false as const,
      error: `${type} must have allowed extension: ${allowed.join(", ")}`,
    };
  }
  return { valid: true as const };
}

/**
 * Validate asset S3 reference { bucket, key }.
 */
export function validateAssetRef(
  ref: { bucket?: string; key?: string } | null | undefined,
  type: AssetType = "image"
) {
  if (!ref || typeof ref !== "object") {
    return { valid: false as const, error: "Asset ref must be { bucket, key }" };
  }
  if (!ref.bucket || typeof ref.bucket !== "string") {
    return { valid: false as const, error: "Asset bucket is required" };
  }
  return validateAssetKey(ref.key, type);
}

/**
 * Validate assets array.
 */
export function validateAssets(
  assets: Array<{ name?: string; bucket?: string; key?: string; base64?: string }> | null | undefined,
  type: AssetType = "image"
) {
  if (!assets || !Array.isArray(assets)) return { valid: true as const };
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (!a || typeof a !== "object") {
      return { valid: false as const, error: `Asset[${i}] must be object` };
    }
    if (!a.name || typeof a.name !== "string") {
      return { valid: false as const, error: `Asset[${i}].name is required` };
    }
    const keyResult = validateS3Key(a.name);
    if (!keyResult.valid) {
      return { valid: false as const, error: `Asset[${i}].name: ${keyResult.error}` };
    }
    if (a.bucket && a.key) {
      const refResult = validateAssetRef({ bucket: a.bucket, key: a.key }, type);
      if (!refResult.valid) return { valid: false as const, error: `Asset[${i}]: ${refResult.error}` };
    } else if (a.base64 && typeof a.base64 === "string") {
      const ext = getExtension(a.name);
      const allowed = type === "image" ? ALLOWED_IMAGE_EXTENSIONS : ALLOWED_FONT_EXTENSIONS;
      if (!ext || !allowed.includes(ext)) {
        return { valid: false as const, error: `Asset[${i}].name must have allowed extension: ${allowed.join(", ")}` };
      }
    } else {
      return { valid: false as const, error: `Asset[${i}]: provide bucket+key or base64` };
    }
  }
  return { valid: true as const };
}
