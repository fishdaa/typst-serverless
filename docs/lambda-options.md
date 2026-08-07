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

Compile a single document.

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| POST | `/compile` | `compile` (default) |

**Required:** `mainTyp` or `mainTypS3` (mutually exclusive).

Via the **Lambda SDK**, these fields (and all optional params below) go at the **top level** of the payload — there is no `documents` wrapper for a direct `compile` invoke; that wrapper is REST-only (see below) or used by the separate `batch` action.

Via the **REST API**, `POST /compile` always takes a top-level `documents` array (1+ items); a single-item array compiles one document, multiple items compile a batch. Each array item uses the same per-document fields as the SDK payload.

**Per-document optional params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `main` | string | `main.typ` | Main .typ filename in workDir (e.g. `document.typ`, `src/report.typ`) |
| `extraTyps` | array | — | Extra .typ sources for `#include()` / modules. Each: `{ name, base64? }` or `{ name, bucket, key }`; `name` = path in workDir (e.g. `lib/module.typ`). |
| `documentId` | string | auto UUID | Custom ID |
| `storeToS3` | boolean | false | Store output in S3; return presigned URL |
| `outputS3` | object | — | `{ bucket, keyPrefix? }` — customer S3 bucket; requires `customerOutputBuckets` in Pulumi |
| `outputKey` | string | — | Custom S3 object key when `storeToS3` is true (e.g. `reports/2024.pdf`). If omitted, key is `keyPrefix` + `documentId` + extension. |
| `outputFormat` | string | `pdf` | `pdf`, `svg`, or `png` |
| `pdfStandard` | string | — | PDF variant: `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` (OTF, TTF, TTC) |
| `assets` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` (PNG, JPEG, GIF, WebP, SVG) |
| `data` | string or object | — | Base64-encoded content or `{ bucket, key }` — S3 reference; written to workDir |
| `dataFile` | string | `data.json` | Filename in workDir. Allowed: .json, .yaml, .yml, .toml, .csv, .xml, .cbor. Template uses matching Typst function. |
| `webhook` | object | — | `{ url: "https://..." }` — POST on completion/failure (HTTPS only) |

**S3 output:** When using a custom `outputKey` (or the default key from `documentId`), uploading again with the same key follows normal S3 behavior: the new object overwrites the existing one at that key.

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

### retrieve

**SDK-only** (not exposed via REST). Fetch a presigned S3 URL for a completed document originally compiled with `storeToS3: true`.

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| — | — | `retrieve` |

**Required:** `documentId`

**Response:** `{ s3Url }` (200); `404` if not found; `409` if not yet `completed`; `400` if the document wasn't stored in S3.

---

### batch

**SDK-only** (not exposed as a distinct REST action — REST's `POST /compile` with a multi-item `documents` array dispatches to this internally). Enqueues each document to SQS for async compilation; requires `storeToS3: true` and a configured batch queue (`enableSqs: true` in Pulumi).

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| — | — | `batch` |

**Required:** `documents` (array, 1+ items, same per-document fields as `compile`)

**Response:** `{ batchId, documentIds }` (200); `503` if the batch queue isn't configured; `400` if `storeToS3` isn't set.

---

### batchstatus

Status for a batch enqueued via `batch`.

| Method | Path (REST) | SDK `action` |
|--------|-------------|--------------|
| GET | `/status/{batchId}` (fallback when `id` isn't a known document) | `batchstatus` |

**Required:** `documentId` or `batchId`

**Response:** `{ batchId, results: [{ documentId, status, s3Url?, error? }, ...] }`

---

### sqs

**Internal only.** Invoked by AWS as the SQS trigger target for queued batch messages — not a client-facing action.

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
| `compile` | mainTyp or mainTypS3 (top-level) | documentId, storeToS3, outputS3, outputKey, outputFormat, pdfStandard, fonts, assets, data, dataFile, webhook |
| `status` | documentId | — |
| `retrieve` | documentId | — |
| `batch` | documents (array, 1+ items) | — (each item: same optional params as `compile`) |
| `batchstatus` | documentId or batchId | — |
