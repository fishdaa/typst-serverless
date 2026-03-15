# Lambda Options Reference

All available Lambda actions and REST API endpoints with their parameters. Use this for both SDK invocation and REST.

---

## Invocation methods

| Method | Use |
|--------|-----|
| **Lambda SDK** | `InvokeCommand` with `action` in payload; `invocationType: "RequestResponse"` (sync) or `"Event"` (async) |
| **REST API** | HTTP `POST` / `GET` to API Gateway (when enabled) |

---

## Actions / Endpoints

### compile

Compile one or more documents. Same structure for single and batch: pass `documents` array with 1+ items.

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| POST | `/compile` | `compile` (default) |

**Required:**

| Param | Type | Description |
|-------|------|-------------|
| `documents` | array | 1 or more items; each has mainTyp or mainTypS3 plus optional fields below |

**Per-document optional params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `main` | string | `main.typ` | Main .typ filename in workDir (e.g. `document.typ`, `src/report.typ`) |
| `documentId` | string | auto UUID | Custom ID |
| `storeToS3` | boolean | false | Store output in S3; return presigned URL |
| `outputS3` | object | — | `{ bucket, keyPrefix? }` — customer S3 bucket; requires `customerOutputBuckets` in Pulumi |
| `outputFormat` | string | `pdf` | `pdf`, `svg`, or `png` |
| `pdfStandard` | string | — | PDF variant: `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` (OTF, TTF, TTC) |
| `assets` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` (PNG, JPEG, GIF, WebP, SVG) |
| `data` | string or object | — | Base64-encoded content or `{ bucket, key }` — S3 reference; written to workDir |
| `dataFile` | string | `data.json` | Filename in workDir. Allowed: .json, .yaml, .yml, .toml, .csv, .xml, .cbor. Template uses matching Typst function. |
| `webhook` | object | — | `{ url: "https://..." }` — POST on completion/failure (HTTPS only) |

**Response (200):**

- Single: `{ documentId, status, pdf?, s3Url?, format? }`
- Multiple: `{ results: [{ documentId, status, s3Url?, error? }, ...] }`
- Phase 5 (SQS): `{ batchId, documentIds }` — poll status for batch

---

### status

Job status for document or batch. Returns status and presigned link when completed.

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| GET | `/status/{id}` | `status` |

**Required:**

| Param | Type | Description |
|-------|------|-------------|
| `documentId` | string | Document or batch ID |

**Response (200):**

- Single: `{ documentId, status, s3Url?, s3_key?, error?, createdAt?, updatedAt? }` — `s3Url` when completed and in S3
- Batch: `{ batchId, results: [{ documentId, status, s3Url?, error? }, ...] }` (Phase 5; SQS + S3)

---

## Limits

| Limit | Value |
|-------|-------|
| Payload size (sync) | 6MB |
| Payload size (async) | 256KB |
| REST API body | 10MB |
| document_id | 1–128 chars; alphanumeric, `-`, `_` |
| S3 key | No `..`, no leading `/`, ASCII only |
| Asset formats | Images: PNG, JPEG, GIF, WebP, SVG. Fonts: OTF, TTF, TTC |

---

## REST path summary

| Method | Path | Action |
|--------|------|--------|
| POST | `/compile` | compile (single or batch via documents array) |
| GET | `/status/{id}` | status (document or batch; includes s3Url when completed) |

---

## SDK action summary

| action | Required params | Optional params |
|--------|-----------------|-----------------|
| `compile` | documents (array, 1+ items) | — (each item: mainTyp/mainTypS3, documentId, storeToS3, outputS3, outputFormat, fonts, assets, data, dataFile, webhook) |
| `status` | documentId | — |
