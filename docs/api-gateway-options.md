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

### Param reference (POST /compile, per-document)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `mainTyp` | string | — | Base64-encoded .typ source (required if not mainTypS3) |
| `mainTypS3` | object | — | `{ bucket, key }` — S3 reference to main.typ (required if not mainTyp) |
| `main` | string | `main.typ` | Main .typ filename in workDir (e.g. `document.typ`, `src/report.typ`) |
| `documentId` | string | auto UUID | Custom document ID |
| `storeToS3` | boolean | false | Store output in S3; return presigned URL |
| `outputS3` | object | — | `{ bucket, keyPrefix? }` — customer S3 bucket; requires `customerOutputBuckets` in Pulumi |
| `outputFormat` | string | `pdf` | `pdf`, `svg`, or `png` |
| `pdfStandard` | string | — | PDF variant: `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` — OTF, TTF, TTC |
| `assets` | array | — | `[{ name, base64 }]` or `[{ name, bucket, key }]` — PNG, JPEG, GIF, WebP, SVG |
| `dataJson` | string or object | — | Base64-encoded JSON or `{ bucket, key }` — S3 reference to data.json (planned) |
| `webhook` | object | — | `{ url: "https://..." }` — POST on completion/failure (HTTPS only) |

---

## Request / Response

- **Content-Type:** `application/json` for POST bodies
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
| `documentId` | No | string | Custom ID; UUID if omitted |
| `storeToS3` | No | boolean | Store output in S3; return presigned URL |
| `outputS3` | No | object | `{ bucket, keyPrefix? }` — customer S3 bucket |
| `outputFormat` | No | string | `pdf` (default), `svg`, `png` |
| `pdfStandard` | No | string | `a-2b`, `a-3b`, `1.4`, `1.5`, etc. |
| `fonts` | No | array | `[{ name, base64 }]` or `[{ name, bucket, key }]` |
| `assets` | No | array | `[{ name, base64 }]` or `[{ name, bucket, key }]` |
| `dataJson` | No | string or object | Base64-encoded JSON or `{ bucket, key }` — S3 reference to data.json (planned) |
| `webhook` | No | object | `{ url: "https://..." }` — POST on completion |

**Response (200):**

- Single document: `{ documentId, status, pdf?, s3Url?, format? }` (base64 pdf or s3Url when storeToS3)
- Multiple documents: `{ results: [{ documentId, status, s3Url?, error? }, ...] }`
- Phase 5 (SQS): `{ batchId, documentIds }` — poll `GET /status/{batchId}` for per-item status

**Examples:**

```bash
# Single document
curl -X POST "$API_URL/compile" -H "Content-Type: application/json" \
  -d '{"documents":[{"mainTyp":"'$(echo -n '#Hello' | base64)'","storeToS3":true}]}'

# Multiple documents
curl -X POST "$API_URL/compile" -H "Content-Type: application/json" \
  -d '{"documents":[{"mainTyp":"'$(echo -n '#doc1' | base64)'","storeToS3":true},{"mainTyp":"'$(echo -n '#doc2' | base64)'","storeToS3":true}]}'
```

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

## Limits

| Limit | Value |
|-------|-------|
| Request body | 10MB |
| document_id / path id | 1–128 chars; alphanumeric, `-`, `_` |
| S3 key | No `..`, no leading `/`, ASCII only |
| Asset formats | Images: PNG, JPEG, GIF, WebP, SVG. Fonts: OTF, TTF, TTC |

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid request (bad JSON, missing/invalid params) |
| 404 | Document or batch not found |
| 409 | Document not completed (retrieve) |
| 413 | Body exceeds 10MB |
| 500 | Internal error |

---

## Authentication

No auth by default. See [docs/api/auth.md](api/auth.md) for IAM or API key auth.
