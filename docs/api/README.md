# REST API (API Gateway) — Phase 3 & 4

HTTP endpoints for Typst compilation via API Gateway. Deploy with `enableApiGateway: true` (default).

**Full reference:** [docs/api-gateway-options.md](../api-gateway-options.md) — all endpoints, params, curl examples.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/compile` | Compile .typ source to PDF, SVG, or PNG (single or batch via `documents` array) |
| GET | `/status/{id}` | Get document or batch status; includes presigned `s3Url` when completed |

## Deploy

API Gateway is enabled by default. After `pulumi up`:

```bash
pulumi stack output apiUrl
# https://xxxx.execute-api.region.amazonaws.com
```

## POST /compile

**Request:** Either `Content-Type: application/json` or `multipart/form-data`.

### JSON

Body must include a `documents` array (one or more items):

```json
{
  "documents": [
    {
      "mainTyp": "<base64-encoded .typ source>",
      "storeToS3": true,
      "documentId": "optional-custom-id"
    }
  ]
}
```

**Per-document optional fields:** `main`, `extraTyps`, `fonts`, `assets`, `mainTypS3`, `outputS3`, `outputKey`, `outputFormat` (`pdf`|`svg`|`png`), `pdfStandard`, `webhook`, `data`, `dataFile`. See [api-gateway-options.md](../api-gateway-options.md) for full param reference.

### Multipart form-data (single document)

One .typ file per request. Part names:

| Part name | Required | Description |
|-----------|----------|-------------|
| `main`, `mainTyp`, or `file` | Yes (one of) | The .typ source file (binary or text) |
| `extraTyp` / `extraTyps` | No | File part(s): additional .typ files for `#include()` (filename = path, e.g. `lib/module.typ`) |
| `documentId` | No | Form field: custom document ID |
| `storeToS3` | No | Form field: `true` or `1` to store output in S3 |
| `outputFormat` | No | Form field: `pdf`, `svg`, or `png` |
| `main` (field) | No | Form field: main filename override (e.g. `report.typ`); default `main.typ` |
| `asset` / `assets` | No | File part(s): images (PNG, JPEG, etc.) |
| `font` / `fonts` | No | File part(s): fonts (OTF, TTF, TTC) |
| `data` | No | File part: template data (e.g. `data.json`); filename becomes `dataFile` |
| `webhook` | No | Form field: HTTPS URL for completion callback |

Response shape is the same as JSON (single document).

**Response (200):**
- Single doc, inline: `{ documentId, status: "completed", pdf?: "<base64>" }`
- Single doc, S3: `{ documentId, status: "completed", s3Url }`
- Multiple docs: `{ results: [ { documentId, status, s3Url?, error? }, ... ] }` or (Phase 5 SQS) `{ batchId, documentIds }` — then poll `GET /status/{batchId}`

**Limits:** Body 10MB; asset formats: PNG, JPEG, GIF, WebP, SVG (images); OTF, TTF, TTC (fonts).

## GET /status/{id}

Returns document or batch status. `id` = document ID or batch ID.

**Response (200):** `{ documentId?, batchId?, status, s3Url?, s3_key?, error?, results?, ... }` — `s3Url` is the presigned download link when completed and stored in S3. Status: `pending` | `compiling` | `completed` | `failed`. For batches (Phase 5): `results` array with per-item status and `s3Url`.

## CORS

CORS is enabled by default. `Access-Control-Allow-Origin: *` for all responses.

## Authentication

No auth by default. See [auth.md](auth.md) for adding IAM or API key auth.
