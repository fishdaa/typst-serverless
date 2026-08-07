/**
 * Input validation for Lambda events.
 * Payload size: 6MB sync, 256KB async. S3 key: no path traversal.
 */

const SYNC_MAX_BYTES = 6 * 1024 * 1024;  // 6MB
const ASYNC_MAX_BYTES = 256 * 1024;      // 256KB
const REST_MAX_BYTES = 10 * 1024 * 1024; // 10MB for API Gateway

/** Valid document_id: alphanumeric, hyphens, underscores; 1-128 chars */
const DOCUMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  documents?: unknown[];
}

export interface S3Ref {
  bucket: string;
  key: string;
}

function isValidS3Key(key: unknown): boolean {
    if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
    if (key.includes("..") || key.startsWith("/")) return false;
    if (/[^\x00-\x7F]/.test(key)) return false;
    return true;
}

/**
 * Validate event payload size.
 */
export function validatePayloadSize(
    event: object,
    asyncInvoke = false
): ValidationResult {
    const limit = asyncInvoke ? ASYNC_MAX_BYTES : SYNC_MAX_BYTES;
    const json = JSON.stringify(event);
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > limit) {
        return {
            valid: false,
            error: `Payload exceeds ${asyncInvoke ? "256KB" : "6MB"} limit (${bytes} bytes)`,
        };
    }
    return { valid: true };
}

/**
 * Validate REST API body size (10MB for API Gateway).
 */
export function validateRestPayloadSize(body: string | Buffer | null | undefined): ValidationResult {
    if (!body) return { valid: true };
    const bytes = typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.length;
    if (bytes > REST_MAX_BYTES) {
        return {
            valid: false,
            error: `Request body exceeds 10MB limit (${bytes} bytes)`,
        };
    }
    return { valid: true };
}

/**
 * Validate document_id format.
 */
export function validateDocumentId(id: unknown): ValidationResult {
    if (!id || typeof id !== "string") {
        return { valid: false, error: "document_id is required" };
    }
    if (!DOCUMENT_ID_REGEX.test(id)) {
        return { valid: false, error: "document_id must be 1-128 chars, alphanumeric, hyphens, underscores" };
    }
    return { valid: true };
}

/**
 * Validate S3 key (no path traversal).
 */
export function validateS3Key(key: unknown): ValidationResult {
    if (!key || typeof key !== "string") {
        return { valid: false, error: "S3 key is required" };
    }
    if (!isValidS3Key(key)) {
        return { valid: false, error: "S3 key invalid: no path traversal (..), no leading slash, ASCII only" };
    }
    return { valid: true };
}

/** Allowed extensions for data file (Typst: json, yaml, toml, csv, xml, cbor). */
const DATA_FILE_EXTENSIONS = [".json", ".yaml", ".yml", ".toml", ".csv", ".xml", ".cbor"];

/**
 * Validate data file name: no path traversal, must end with an allowed extension.
 */
export function validateDataFile(filename: unknown): ValidationResult {
    if (filename == null || filename === "") return { valid: true };
    if (typeof filename !== "string") {
        return { valid: false, error: "dataFile must be a string" };
    }
    if (filename.length === 0 || filename.length > 1024) {
        return { valid: false, error: "dataFile must be 1-1024 chars" };
    }
    if (filename.includes("..") || filename.startsWith("/") || filename.includes("\\") || filename.includes("/")) {
        return { valid: false, error: "dataFile invalid: no path traversal, no path separators" };
    }
    const lower = filename.toLowerCase();
    if (!DATA_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        return { valid: false, error: `dataFile must end with one of: ${DATA_FILE_EXTENSIONS.join(", ")}` };
    }
    return { valid: true };
}

/**
 * Validate data: base64 string or { bucket, key }.
 */
export function validateData(data: unknown, dataFile?: unknown): ValidationResult {
    if (!data) return { valid: true };
    const fileResult = validateDataFile(dataFile ?? "data.json");
    if (!fileResult.valid) return fileResult;
    if (typeof data === "string") return { valid: true };
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        if (typeof d.assetPath === "string") return validateAssetPath(d.assetPath);
        return validateS3Ref(data);
    }
    return { valid: false, error: "data must be base64 string, { bucket, key }, or { assetPath }" };
}

/** Valid asset path: no path traversal, no leading slash, ASCII only, 1-1024 chars. */
export function validateAssetPath(assetPath: unknown): ValidationResult {
    if (!assetPath || typeof assetPath !== "string") {
        return { valid: false, error: "assetPath is required" };
    }
    if (!isValidS3Key(assetPath)) {
        return { valid: false, error: "assetPath invalid: no path traversal (..), no leading slash, ASCII only" };
    }
    return { valid: true };
}

/**
 * Validate S3 reference { bucket, key }.
 */
export function validateS3Ref(ref: unknown): ValidationResult {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        return { valid: false, error: "S3 ref must be { bucket, key }" };
    }
    const r = ref as Record<string, unknown>;
    if (!r.bucket || typeof r.bucket !== "string") {
        return { valid: false, error: "S3 bucket is required" };
    }
    const keyResult = validateS3Key(r.key);
    if (!keyResult.valid) return keyResult;
    return { valid: true };
}

/**
 * Validate optional main typ filename (path relative to workDir).
 * Must end with .typ, no path traversal, ASCII only.
 */
export function validateMainTyp(filename: unknown): ValidationResult {
    if (filename == null || filename === "") return { valid: true };
    if (typeof filename !== "string") {
        return { valid: false, error: "main must be a string" };
    }
    if (filename.length === 0 || filename.length > 1024) {
        return { valid: false, error: "main must be 1-1024 chars" };
    }
    if (!isValidS3Key(filename)) {
        return { valid: false, error: "main invalid: no path traversal (..), no leading slash, ASCII only" };
    }
    if (!filename.toLowerCase().endsWith(".typ")) {
        return { valid: false, error: "main must end with .typ" };
    }
    return { valid: true };
}

/** Valid name for an extra .typ source: path relative to workDir, ends with .typ, no traversal */
export function validateExtraTypName(name: unknown): ValidationResult {
    if (name == null || typeof name !== "string" || name.length === 0 || name.length > 1024) {
        return { valid: false, error: "extraTyp name must be a non-empty string (1-1024 chars)" };
    }
    if (!isValidS3Key(name)) {
        return { valid: false, error: "extraTyp name invalid: no path traversal (..), no leading slash, ASCII only" };
    }
    if (!name.toLowerCase().endsWith(".typ")) {
        return { valid: false, error: "extraTyp name must end with .typ" };
    }
    return { valid: true };
}

/**
 * Validate extraTyps array: optional additional .typ sources for #include / modules.
 * Each item: { name: string } with either base64 or { bucket, key }.
 */
export function validateExtraTyps(extraTyps: unknown): ValidationResult {
    if (!extraTyps || !Array.isArray(extraTyps)) return { valid: true };
    for (let i = 0; i < extraTyps.length; i++) {
        const item = extraTyps[i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return { valid: false, error: `extraTyps[${i}] must be an object { name, base64? } or { name, bucket, key }` };
        }
        const o = item as Record<string, unknown>;
        if (!o.name || typeof o.name !== "string") {
            return { valid: false, error: `extraTyps[${i}].name is required` };
        }
        const nameResult = validateExtraTypName(o.name);
        if (!nameResult.valid) return { valid: false, error: `extraTyps[${i}]: ${nameResult.error}` };
        const hasBase64 = o.base64 != null && typeof o.base64 === "string";
        const hasS3 = o.bucket != null && o.key != null && typeof o.bucket === "string" && typeof o.key === "string";
        const hasAssetPath = typeof o.assetPath === "string";
        if (!hasBase64 && !hasS3 && !hasAssetPath) {
            return { valid: false, error: `extraTyps[${i}]: provide base64, bucket+key, or assetPath` };
        }
        if (hasS3) {
            const s3 = validateS3Ref({ bucket: o.bucket, key: o.key });
            if (!s3.valid) return { valid: false, error: `extraTyps[${i}]: ${s3.error}` };
        }
        if (hasAssetPath) {
            const ap = validateAssetPath(o.assetPath);
            if (!ap.valid) return { valid: false, error: `extraTyps[${i}]: ${ap.error}` };
        }
    }
    return { valid: true };
}

/**
 * Validate compile event schema.
 */
export function validateCompileEvent(event: unknown): ValidationResult {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        return { valid: false, error: "Event must be an object" };
    }
    const e = event as Record<string, unknown>;
    const hasInline = e.mainTyp && typeof e.mainTyp === "string";
    const hasS3 = e.mainTypS3 && typeof e.mainTypS3 === "object";
    const hasAssetPath = typeof e.mainTypAssetPath === "string";
    if (!hasInline && !hasS3 && !hasAssetPath) {
        return { valid: false, error: "mainTyp (base64), mainTypS3 (bucket, key), or mainTypAssetPath is required" };
    }
    if ([hasInline, hasS3, hasAssetPath].filter(Boolean).length > 1) {
        return { valid: false, error: "Provide only one of mainTyp, mainTypS3, mainTypAssetPath" };
    }
    if (hasS3) {
        const s3 = validateS3Ref(e.mainTypS3);
        if (!s3.valid) return s3;
    }
    if (hasAssetPath) {
        const ap = validateAssetPath(e.mainTypAssetPath);
        if (!ap.valid) return ap;
    }
    if (e.main !== undefined) {
        const mainResult = validateMainTyp(e.main);
        if (!mainResult.valid) return mainResult;
    }
    if (e.extraTyps !== undefined) {
        const extraResult = validateExtraTyps(e.extraTyps);
        if (!extraResult.valid) return extraResult;
    }
    if (e.documentId) {
        const id = validateDocumentId(e.documentId);
        if (!id.valid) return id;
    }
    return { valid: true };
}

/**
 * Validate webhook URL. Must be HTTPS (security).
 */
export function validateWebhookUrl(url: unknown): ValidationResult {
    if (!url || typeof url !== "string") {
        return { valid: false, error: "webhook.url is required" };
    }
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") {
            return { valid: false, error: "webhook URL must use https" };
        }
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
            return { valid: false, error: "webhook URL cannot be localhost" };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: "webhook URL is invalid" };
    }
}

/**
 * Validate batch event: documents must be non-empty array.
 */
export function validateBatchEvent(event: unknown): ValidationResult & { documents?: unknown[] } {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        return { valid: false, error: "Event must be an object" };
    }
    const e = event as Record<string, unknown>;
    if (!Array.isArray(e.documents)) {
        return { valid: false, error: "batch.documents must be an array" };
    }
    if (e.documents.length === 0) {
        return { valid: false, error: "batch.documents cannot be empty" };
    }
    return { valid: true, documents: e.documents };
}

/**
 * Validate status/retrieve event: documentId required.
 */
export function validateStatusEvent(event: unknown): ValidationResult {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        return { valid: false, error: "Event must be an object" };
    }
    const e = event as Record<string, unknown>;
    if (!e.documentId) {
        return { valid: false, error: "documentId is required for status" };
    }
    return validateDocumentId(e.documentId);
}
