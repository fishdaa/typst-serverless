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

/**
 * Get file extension from key (lowercase).
 * @param {string} key - S3 key or file path
 * @returns {string|null}
 */
function getExtension(key) {
  if (!key || typeof key !== "string") return null;
  const idx = key.lastIndexOf(".");
  if (idx < 0 || idx === key.length - 1) return null;
  return key.slice(idx).toLowerCase();
}

/**
 * Validate asset key: allowed type and no path traversal.
 * @param {string} key - S3 key or file path
 * @param {string} type - "image" | "font"
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateAssetKey(key, type = "image") {
  const keyResult = validateS3Key(key);
  if (!keyResult.valid) return keyResult;
  const ext = getExtension(key);
  const allowed = type === "image" ? ALLOWED_IMAGE_EXTENSIONS : ALLOWED_FONT_EXTENSIONS;
  if (!ext || !allowed.includes(ext)) {
    return {
      valid: false,
      error: `${type} must have allowed extension: ${allowed.join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Validate asset S3 reference { bucket, key }.
 * @param {object} ref - { bucket, key }
 * @param {string} type - "image" | "font"
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateAssetRef(ref, type = "image") {
  if (!ref || typeof ref !== "object") {
    return { valid: false, error: `Asset ref must be { bucket, key }` };
  }
  if (!ref.bucket || typeof ref.bucket !== "string") {
    return { valid: false, error: "Asset bucket is required" };
  }
  return validateAssetKey(ref.key, type);
}

/**
 * Validate assets array: [{ name, bucket, key }] or [{ name, base64 }].
 * name: local path used in .typ (e.g. "image.png", "fonts/custom.otf").
 * @param {Array} assets - Array of asset refs
 * @param {string} type - "image" | "font"
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateAssets(assets, type = "image") {
  if (!assets || !Array.isArray(assets)) return { valid: true };
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (!a || typeof a !== "object") {
      return { valid: false, error: `Asset[${i}] must be object` };
    }
    if (!a.name || typeof a.name !== "string") {
      return { valid: false, error: `Asset[${i}].name is required` };
    }
    const keyResult = validateS3Key(a.name);
    if (!keyResult.valid) {
      return { valid: false, error: `Asset[${i}].name: ${keyResult.error}` };
    }
    if (a.bucket && a.key) {
      const refResult = validateAssetRef({ bucket: a.bucket, key: a.key }, type);
      if (!refResult.valid) return { valid: false, error: `Asset[${i}]: ${refResult.error}` };
    } else if (a.base64 && typeof a.base64 === "string") {
      const ext = getExtension(a.name);
      const allowed = type === "image" ? ALLOWED_IMAGE_EXTENSIONS : ALLOWED_FONT_EXTENSIONS;
      if (!ext || !allowed.includes(ext)) {
        return { valid: false, error: `Asset[${i}].name must have allowed extension: ${allowed.join(", ")}` };
      }
    } else {
      return { valid: false, error: `Asset[${i}]: provide bucket+key or base64` };
    }
  }
  return { valid: true };
}
