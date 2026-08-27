/**
 * Validation for presigned direct-to-S3 uploads.
 *
 * Two namespaces exist, both living in the assets bucket:
 *   - `assets/<assetPath>`      persistent, curated asset library (never expires)
 *   - `uploads/<jobId>/<name>`  ephemeral inputs for one compile job (lifecycle-expired)
 *
 * A presigned PUT is an unauthenticated write into the bucket for as long as it
 * lives, so every request is bound to an extension, a content type, and an exact
 * byte length before it is signed.
 */
import { validateAssetPath, type ValidationResult } from "./validate.js";
import { ALLOWED_IMAGE_EXTENSIONS, ALLOWED_FONT_EXTENSIONS, getExtension } from "./assets.js";

export { validateJobId, validateUploadRef } from "./validate.js";

/** Data-file extensions Typst can read via #json/#yaml/#toml/#csv/#xml/#cbor. */
export const ALLOWED_DATA_EXTENSIONS = [".json", ".yaml", ".yml", ".toml", ".csv", ".xml", ".cbor"];

/**
 * Extensions accepted for a presigned upload: anything the compiler can
 * legitimately consume as an input (sources, data, images, fonts).
 */
export const ALLOWED_UPLOAD_EXTENSIONS = [
    ".typ",
    ...ALLOWED_DATA_EXTENSIONS,
    ...ALLOWED_IMAGE_EXTENSIONS,
    ...ALLOWED_FONT_EXTENSIONS,
];

/** Default per-object upload ceiling; override with TYPST_MAX_UPLOAD_BYTES. */
export const DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024; // 256MB

/** Most files one presign call may sign, so a single request cannot fan out unbounded work. */
export const MAX_PRESIGN_BATCH = 100;

/** Resolved per-object upload ceiling in bytes. */
export function maxUploadBytes(): number {
    const raw = process.env.TYPST_MAX_UPLOAD_BYTES;
    if (!raw) return DEFAULT_MAX_UPLOAD_BYTES;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
}

function formatMB(bytes: number): string {
    return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

export interface UploadRequest {
    /** Target path: assetPath for the library, name for a job upload. */
    path: unknown;
    contentType: unknown;
    sizeBytes: unknown;
}

/**
 * Validate one presign request. `sizeBytes` and `contentType` are required
 * because both are signed into the URL — that is what stops a leaked URL from
 * becoming an unbounded write of arbitrary content.
 */
export function validateUploadRequest(req: UploadRequest, label = "assetPath"): ValidationResult {
    const pathResult = validateAssetPath(req.path);
    if (!pathResult.valid) {
        return { valid: false, error: pathResult.error?.replace("assetPath", label) };
    }
    const path = req.path as string;
    const ext = getExtension(path);
    if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
        return {
            valid: false,
            error: `${label} must have allowed extension: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}`,
        };
    }
    if (!req.contentType || typeof req.contentType !== "string") {
        return { valid: false, error: "contentType is required (it is signed into the upload URL)" };
    }
    if (req.contentType.length > 255 || /[^\x20-\x7E]/.test(req.contentType)) {
        return { valid: false, error: "contentType must be printable ASCII (<= 255 chars)" };
    }
    if (req.sizeBytes == null) {
        return { valid: false, error: "sizeBytes is required (it is signed into the upload URL)" };
    }
    const size = Number(req.sizeBytes);
    if (!Number.isInteger(size) || size <= 0) {
        return { valid: false, error: "sizeBytes must be a positive integer" };
    }
    const limit = maxUploadBytes();
    if (size > limit) {
        return { valid: false, error: `sizeBytes exceeds the ${formatMB(limit)} upload limit (${size} bytes)` };
    }
    return { valid: true };
}

/**
 * Validate the list form of a presign request. Returns the normalized items so
 * callers do not re-derive them.
 */
export function validateUploadRequests(
    items: unknown,
    label = "assetPath"
): ValidationResult & { items?: Array<{ path: string; contentType: string; sizeBytes: number }> } {
    if (!Array.isArray(items) || items.length === 0) {
        return { valid: false, error: `Provide at least one upload request (${label}, contentType, sizeBytes)` };
    }
    if (items.length > MAX_PRESIGN_BATCH) {
        return { valid: false, error: `Cannot presign more than ${MAX_PRESIGN_BATCH} files in one request` };
    }
    const normalized: Array<{ path: string; contentType: string; sizeBytes: number }> = [];
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return { valid: false, error: `[${i}] must be an object { ${label}, contentType, sizeBytes }` };
        }
        const o = item as Record<string, unknown>;
        const path = label === "name" ? o.name : o.assetPath;
        const result = validateUploadRequest({ path, contentType: o.contentType, sizeBytes: o.sizeBytes }, label);
        if (!result.valid) return { valid: false, error: `[${i}]: ${result.error}` };
        const pathStr = path as string;
        if (seen.has(pathStr)) {
            return { valid: false, error: `[${i}]: duplicate ${label} "${pathStr}"` };
        }
        seen.add(pathStr);
        normalized.push({
            path: pathStr,
            contentType: o.contentType as string,
            sizeBytes: Number(o.sizeBytes),
        });
    }
    return { valid: true, items: normalized };
}
