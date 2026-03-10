/**
 * Input validation for Lambda events.
 * Payload size: 6MB sync, 256KB async. S3 key: no path traversal.
 */

const SYNC_MAX_BYTES = 6 * 1024 * 1024;  // 6MB
const ASYNC_MAX_BYTES = 256 * 1024;      // 256KB

/** Valid document_id: alphanumeric, hyphens, underscores; 1-128 chars */
const DOCUMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

/** S3 key: no path traversal, valid charset */
function isValidS3Key(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.includes("..") || key.startsWith("/")) return false;
  if (/[^\x00-\x7F]/.test(key)) return false;  // ASCII only for simplicity
  return true;
}

/**
 * Validate event payload size.
 * @param {object} event - Lambda event
 * @param {boolean} [asyncInvoke=false]
 * @returns {{ valid: boolean; error?: string }}
 */
export function validatePayloadSize(event, asyncInvoke = false) {
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
 * Validate document_id format.
 * @param {string} id
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateDocumentId(id) {
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
 * @param {string} key
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateS3Key(key) {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "S3 key is required" };
  }
  if (!isValidS3Key(key)) {
    return { valid: false, error: "S3 key invalid: no path traversal (..), no leading slash, ASCII only" };
  }
  return { valid: true };
}

/**
 * Validate S3 reference { bucket, key }.
 */
export function validateS3Ref(ref) {
  if (!ref || typeof ref !== "object") {
    return { valid: false, error: "S3 ref must be { bucket, key }" };
  }
  if (!ref.bucket || typeof ref.bucket !== "string") {
    return { valid: false, error: "S3 bucket is required" };
  }
  const keyResult = validateS3Key(ref.key);
  if (!keyResult.valid) return keyResult;
  return { valid: true };
}

/**
 * Validate compile event schema.
 * Required: mainTyp (base64) XOR mainTypS3 (bucket, key)
 * Optional: dataJson (base64), storeToS3 (bool), documentId (for tracking)
 */
export function validateCompileEvent(event) {
  if (!event || typeof event !== "object") {
    return { valid: false, error: "Event must be an object" };
  }
  const hasInline = event.mainTyp && typeof event.mainTyp === "string";
  const hasS3 = event.mainTypS3 && typeof event.mainTypS3 === "object";
  if (!hasInline && !hasS3) {
    return { valid: false, error: "mainTyp (base64) or mainTypS3 (bucket, key) is required" };
  }
  if (hasInline && hasS3) {
    return { valid: false, error: "Provide mainTyp or mainTypS3, not both" };
  }
  if (hasS3) {
    const s3 = validateS3Ref(event.mainTypS3);
    if (!s3.valid) return s3;
  }
  if (event.documentId) {
    const id = validateDocumentId(event.documentId);
    if (!id.valid) return id;
  }
  return { valid: true };
}

/**
 * Validate status/retrieve event: documentId required.
 */
export function validateStatusEvent(event) {
  if (!event || typeof event !== "object") {
    return { valid: false, error: "Event must be an object" };
  }
  if (!event.documentId) {
    return { valid: false, error: "documentId is required for status" };
  }
  return validateDocumentId(event.documentId);
}
