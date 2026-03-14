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

/**
 * Validate dataJson: base64 string or { bucket, key }.
 */
export function validateDataJson(dataJson: unknown): ValidationResult {
    if (!dataJson) return { valid: true };
    if (typeof dataJson === "string") return { valid: true };
    if (typeof dataJson === "object" && dataJson !== null && !Array.isArray(dataJson)) {
        return validateS3Ref(dataJson);
    }
    return { valid: false, error: "dataJson must be base64 string or { bucket, key }" };
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
 * Validate compile event schema.
 */
export function validateCompileEvent(event: unknown): ValidationResult {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        return { valid: false, error: "Event must be an object" };
    }
    const e = event as Record<string, unknown>;
    const hasInline = e.mainTyp && typeof e.mainTyp === "string";
    const hasS3 = e.mainTypS3 && typeof e.mainTypS3 === "object";
    if (!hasInline && !hasS3) {
        return { valid: false, error: "mainTyp (base64) or mainTypS3 (bucket, key) is required" };
    }
    if (hasInline && hasS3) {
        return { valid: false, error: "Provide mainTyp or mainTypS3, not both" };
    }
    if (hasS3) {
        const s3 = validateS3Ref(e.mainTypS3);
        if (!s3.valid) return s3;
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
