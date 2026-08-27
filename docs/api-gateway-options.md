# API Gateway Options Reference

All available REST endpoints when API Gateway is enabled (`enableApiGateway: true`). Use this for HTTP clients, curl, and integrations.

---

## Base URL

After deploy:

```bash
pulumi stack output apiUrl
# https://xxxx.execute-api.region.amazonaws.com
```

All paths are relative to this base URL.

---

## Endpoints Overview

| Method | Path | Params | Return |
|--------|------|--------|--------|
| POST | `/compile` | `documents`: array (1+ items); each item — see param reference below | Single: `{ documentId, status, pdf?, s3Url?, format? }`. Multiple: `{ results: [...] }` or (Phase 5 SQS) `{ batchId, documentIds }` |
| GET | `/status/{id}` | Path `id`: document or batch ID | `{ documentId?, batchId?, status, s3Url?, ... }` — includes presigned link when completed |
| POST | `/batch` | `documents`: array (1+ items); `storeToS3` required | `{ batchId, documentIds }` — always enqueues, even for one document |
| POST | `/assets/presign` | `assetPath` + `contentType` + `sizeBytes`, or `assets[]` | `{ assetPath, uploadUrl, headers, sizeBytes, expiresAt }` or `{ uploads: [...] }` |
| POST | `/uploads` | `files[]` (`name` + `contentType` + `sizeBytes`), optional `jobId` | `{ jobId, uploads: [{ name, uploadRef, uploadUrl, headers }], expiresAt }` |

### Param reference (POST /compile, per-document)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `mainTyp` | string | — | Base64-encoded .typ source (required if not mainTypS3) |
| `mainTypS3` | object | — | `{ bucket, key }` — S3 reference to main.typ (required if not mainTyp) |
| `mainTypAssetPath` | string | — | Path of a persistent library asset holding the main .typ |
| `mainTypUploadRef` | object | — | `{ jobId, name }` — an ephemeral presigned job upload holding the main .typ |
| `main` | string | `main.typ` | Main .typ filename in workDir (e.g. `document.typ`, `src/report.typ`) |
| `extraTyps` | array | — | Optional extra .typ sources for `#include()` / modules. Each item: `{ name, base64? }` or `{ name, bucket, key }`. `name` = path relative to workDir (e.g. `lib/module.typ`). Written alongside main so Typst can resolve includes. |
| `documentId` | string | auto UUID | Custom document ID |
| `storeToS3` | boolean | false | Store output in S3; return presigned URL |
| `outputS3` | object | — | `{ bucket, keyPrefix? }` — customer S3 bucket; requires `customerOutputBuckets` in Pulumi |
| `outputKey` | string | — | Custom S3 object key when `storeToS3` is true (e.g. `reports/2024.pdf`). If omitted, key is `keyPrefix` + `documentId` + extension. |
| `outputFormat` | string | `pdf` | `pdf`, `svg`, or `png` |
| `pdfStandard` | string | — | PDF variant: `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | array | — | `[{ name, base64 }]`, `[{ name, bucket, key }]`, `[{ name, assetPath }]`, or `[{ name, uploadRef }]` — OTF, TTF, TTC |
| `assets` | array | — | `[{ name, base64 }]`, `[{ name, bucket, key }]`, `[{ name, assetPath }]`, or `[{ name, uploadRef }]` — PNG, JPEG, GIF, WebP, SVG |
| `data` | string or object | — | Base64-encoded content, `{ bucket, key }`, `{ assetPath }`, or `{ uploadRef }`; written to workDir for Typst |
| `dataFile` | string | `data.json` | Local filename in workDir (e.g. `data.yaml`, `config.toml`). Allowed: `.json`, `.yaml`, `.yml`, `.toml`, `.csv`, `.xml`, `.cbor`. Template must use matching Typst function: `json()`, `yaml()`, `toml()`, etc. |
| `webhook` | object | — | `{ url: "https://..." }` — POST on completion/failure (HTTPS only) |

> **Inputs larger than a few MB:** the request body is capped at 10MB (API Gateway) and base64 inflates bytes by ~33%. Presign a direct-to-S3 upload (`POST /assets/presign` or `POST /uploads`), `PUT` the bytes from the client, then reference the object by `assetPath` or `uploadRef` above. On the async path (`POST /batch`) this is mandatory, not optional — the async payload limit is 256KB. Full walkthrough: [docs/api/README.md](api/README.md#large-inputs-presigned-direct-to-s3-uploads).

---

## Request / Response

- **Content-Type:** POST /compile accepts `application/json` or `multipart/form-data`. See [Multipart form-data](#multipart-form-data-single-document) below.
- **Response:** JSON; errors return `{ error: "..." }` with 4xx/5xx status
- **CORS:** `Access-Control-Allow-Origin: *` on all responses

---

## POST /compile

Compile one or more documents. Same structure for single and batch: pass `documents` array with 1 or more items.

**Request body (JSON):**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `documents` | Yes | array | 1 or more items; each has shape below |

**Per-document fields (each item in `documents`):**

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `mainTyp` | one of | string | Base64-encoded .typ source |
| `mainTypS3` | one of | object | `{ bucket, key }` — S3 reference to main.typ |
| `main` | No | string | Main .typ filename (default `main.typ`); e.g. `document.typ`, `src/report.typ` |
| `extraTyps` | No | array | Extra .typ sources for `#include()` / modules. Each: `{ name, base64? }` or `{ name, bucket, key }`; `name` = path in workDir (e.g. `lib/module.typ`). |
| `documentId` | No | string | Custom ID; UUID if omitted |
| `storeToS3` | No | boolean | Store output in S3; return presigned URL |
| `outputS3` | No | object | `{ bucket, keyPrefix? }` — customer S3 bucket |
| `outputKey` | No | string | Custom S3 object key when `storeToS3` is true (e.g. `reports/2024.pdf`) |
| `outputFormat` | No | string | `pdf` (default), `svg`, `png` |
| `pdfStandard` | No | string | `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | No | array | `[{ name, base64 }]` or `[{ name, bucket, key }]` |
| `assets` | No | array | `[{ name, base64 }]` or `[{ name, bucket, key }]` |
| `data` | No | string or object | Base64-encoded content or `{ bucket, key }` — S3 reference; written to workDir |
| `dataFile` | No | string | Filename in workDir (default `data.json`). Allowed extensions: .json, .yaml, .yml, .toml, .csv, .xml, .cbor |
| `webhook` | No | object | `{ url: "https://..." }` — POST on completion |

**S3 output:** When using a custom `outputKey` (or the default key from `documentId`), uploading again with the same key follows normal S3 behavior: the new object overwrites the existing one at that key.

**Response (200):**

- Single document: `{ documentId, status, pdf?, s3Url?, format? }` (base64 pdf or s3Url when storeToS3)
- Multiple documents: `{ results: [{ documentId, status, s3Url?, error? }, ...] }`
- Phase 5 (SQS): `{ batchId, documentIds }` — poll `GET /status/{batchId}` for per-item status

**Examples:**

```bash
# Single document (JSON)
curl -X POST "$API_URL/compile" -H "Content-Type: application/json" \
  -d '{"documents":[{"mainTyp":"'$(echo -n '#Hello' | base64)'","storeToS3":true}]}'

# Multiple documents (JSON)
curl -X POST "$API_URL/compile" -H "Content-Type: application/json" \
  -d '{"documents":[{"mainTyp":"'$(echo -n '#doc1' | base64)'","storeToS3":true},{"mainTyp":"'$(echo -n '#doc2' | base64)'","storeToS3":true}]}'

# Single document (multipart)
curl -X POST "$API_URL/compile" -F "main=@report.typ" -F "documentId=my-doc" "$API_URL/compile"
```

---

## Multipart form-data (single document)

When `Content-Type` is `multipart/form-data`, POST /compile accepts a **single** document. No `documents` array; the .typ source is sent as a file part.

| Part name | Required | Type | Description |
|-----------|----------|------|-------------|
| `main`, `mainTyp`, or `file` | Yes (one of) | File | The .typ source file |
| `extraTyp` / `extraTyps` | No | File(s) | Additional .typ files for `#include()` / modules. Multiple parts allowed. **Flat filenames only** — multipart parsers strip directory components from `filename`, so nested paths (e.g. `lib/module.typ`) don't survive; use the JSON API's `extraTyps[].name` field for nested includes. |
| `documentId` | No | Field | Custom document ID |
| `storeToS3` | No | Field | `true` or `1` to store output in S3 |
| `outputFormat` | No | Field | `pdf`, `svg`, `png` |
| `pdfStandard` | No | Field | PDF variant (`a-2b`, `a-3b`, `1.4`, `1.5`, etc.); PDF only |
| `main` (field) | No | Field | Main filename override (default `main.typ`) |
| `asset` / `assets` | No | File(s) | Images (PNG, JPEG, GIF, WebP, SVG) |
| `font` / `fonts` | No | File(s) | Fonts (OTF, TTF, TTC) |
| `data` | No | File | Template data file; filename used as `dataFile` |
| `webhook` | No | Field | HTTPS URL for completion callback |

Response is the same as JSON single-document: `{ documentId, status, pdf?, s3Url?, format? }`.

---

## GET /status/{id}

Job status for a document or batch. Path param `id` = document ID or batch ID. Returns status and presigned link when completed.

**Response (200):**

- Single document: `{ documentId, status, s3Url?, s3_key?, error?, createdAt?, updatedAt? }` — `s3Url` present when completed and stored in S3
- Batch: `{ batchId, results: [{ documentId, status, s3Url?, error? }, ...] }` (Phase 5; requires SQS + S3)

**Status:** `pending` | `compiling` | `completed` | `failed`

**Example:**

```bash
curl "$API_URL/status/doc-123"
```

---

## POST /assets/presign and POST /uploads

Sign direct-to-S3 upload URL(s) so the client sends the bytes to S3 and the compile request carries only a reference. Optional for sync compiles; the only route for large async inputs, whose payload limit is 256KB. Full walkthrough: [docs/api/README.md](api/README.md#large-inputs-presigned-direct-to-s3-uploads).

| Endpoint | Key written | Lifetime |
|----------|-------------|----------|
| `POST /assets/presign` | `assets/<assetPath>` | Permanent, until deleted |
| `POST /uploads` | `uploads/<jobId>/<name>` | Expired by an S3 lifecycle rule (`uploadRetentionDays`, default 1 day) |

**Request:**

```bash
# Persistent library asset (single; or pass assets[] for up to 100 at once)
curl -X POST "$API_URL/assets/presign" -H 'Content-Type: application/json' -d '{
  "assetPath": "brand/logo.png", "contentType": "image/png", "sizeBytes": 184320
}'

# Ephemeral job inputs — one call signs every file for the job
curl -X POST "$API_URL/uploads" -H 'Content-Type: application/json' -d '{
  "files": [
    { "name": "main.typ", "contentType": "text/plain", "sizeBytes": 812 },
    { "name": "bg.png", "contentType": "image/png", "sizeBytes": 48211900 }
  ]
}'
```

`contentType` and `sizeBytes` are required — both are signed into the URL, so a leaked URL can only write that content type at that exact byte length. Max per object: `TYPST_MAX_UPLOAD_BYTES` (default 256MB). Max 100 files per call. The path must end in an extension the compiler can consume: `.typ`, a data file, an image, or a font.

**Response (200):** `{ assetPath, uploadUrl, contentType, sizeBytes, headers, expiresAt }` (single) or `{ uploads: [...], expiresAt }`. `/uploads` returns `{ jobId, uploads: [{ name, uploadRef, uploadUrl, headers, ... }], expiresAt, maxUploadBytes }`.

**Then upload and reference:**

```bash
# Echo the returned headers verbatim — they are part of the signature
curl -X PUT "$UPLOAD_URL" -H "Content-Type: image/png" -H "Content-Length: 48211900" \
  --data-binary @bg.png

curl -X POST "$API_URL/compile" -H 'Content-Type: application/json' -d '{
  "documents": [{
    "mainTypUploadRef": { "jobId": "3f1b…", "name": "main.typ" },
    "assets": [{ "name": "bg.png", "uploadRef": { "jobId": "3f1b…", "name": "bg.png" } }],
    "storeToS3": true
  }]
}'
```

Referenced objects are `HEAD`-checked before compiling, so an upload that never completed is a `400` naming the missing keys — on `POST /batch`, before anything is enqueued.

**503** if no assets bucket is configured (`TYPST_ASSETS_BUCKET`, falling back to `TYPST_INPUT_BUCKET`).

---

## Limits

| Limit | Value |
|-------|-------|
| Request body | 10MB |
| Presigned upload size | `TYPST_MAX_UPLOAD_BYTES`, default 256MB per object |
| Presigned uploads per call | 100 |
| Presigned URL lifetime | `TYPST_PRESIGNED_EXPIRY`, default 3600s |
| document_id / path id | 1–128 chars; alphanumeric, `-`, `_` |
| S3 key | No `..`, no leading `/`, ASCII only |
| Asset formats | Images: PNG, JPEG, GIF, WebP, SVG. Fonts: OTF, TTF, TTC |

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid request (bad JSON, missing/invalid params, or a referenced `assetPath`/`uploadRef` that is not in S3) |
| 404 | Document or batch not found |
| 413 | Body exceeds 10MB |
| 500 | Internal error |

---

## Authentication

No auth by default. See [docs/api/auth.md](api/auth.md) for IAM or API key auth.
