# REST API (API Gateway) — Phase 3 & 4

HTTP endpoints for Typst compilation via API Gateway. Deploy with `enableApiGateway: true` (default).

**Full reference:** [docs/api-gateway-options.md](../api-gateway-options.md) — all endpoints, params, curl examples.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/compile` | Compile .typ source to PDF, SVG, or PNG |
| POST | `/batch` | Compile multiple documents |
| GET | `/documents/{id}` | Get document status |
| GET | `/documents/{id}/pdf` | Get presigned URL to download PDF (when stored in S3) |

## Deploy

API Gateway is enabled by default. After `pulumi up`:

```bash
pulumi stack output apiUrl
# https://xxxx.execute-api.region.amazonaws.com
```

## POST /compile

**Request:** `Content-Type: application/json`

```json
{
  "mainTyp": "<base64-encoded .typ source>",
  "storeToS3": true,
  "documentId": "optional-custom-id"
}
```

**Optional fields:**
- `fonts` — Array of font files: `[{ "name": "fonts/custom.otf", "base64": "..." }]` or `[{ "name": "fonts/custom.otf", "bucket": "...", "key": "..." }]`
- `assets` — Array of images: `[{ "name": "logo.png", "base64": "..." }]` or S3 refs
- `mainTypS3` — `{ "bucket": "...", "key": "..." }` instead of inline
- `outputS3` — Customer-owned S3: `{ "bucket": "my-bucket", "keyPrefix": "pdfs/" }`
- `outputFormat` — Output format: `"pdf"` (default), `"svg"`, or `"png"`
- `pdfStandard` — PDF standard for PDF output: `"a-2b"`, `"a-3b"`, `"1.4"`, `"1.5"`, etc.
- `webhook` — `{ "url": "https://..." }` — POST completion status and s3Url/pdf to your endpoint
- `dataJson` — Base64-encoded JSON for template data

**Response (200):**
- `storeToS3: true` → `{ documentId, status: "completed", s3Url }`
- Default → `{ documentId, status: "completed", pdf: "<base64>" }`

**Limits:**
- Body size: 10MB
- Asset formats: PNG, JPEG, GIF, WebP, SVG (images); OTF, TTF, TTC (fonts)

## POST /batch

Compile multiple documents in one request.

**Request:** `Content-Type: application/json`

```json
{
  "documents": [
    { "mainTyp": "<base64>", "storeToS3": true },
    { "mainTypS3": { "bucket": "...", "key": "..." } }
  ]
}
```

**Response (200):** `{ "results": [ { "documentId", "status", "s3Url?", "error?" }, ... ] }`

Each item in `documents` supports the same fields as POST /compile (fonts, assets, outputFormat, webhook, etc.).

## GET /documents/{id}

Returns document status: `{ documentId, status, s3_key?, error?, createdAt?, updatedAt? }`

## GET /documents/{id}/pdf

Returns presigned URL when PDF was stored in S3: `{ s3Url }`

## CORS

CORS is enabled by default. `Access-Control-Allow-Origin: *` for all responses.

## Authentication

No auth by default. See [auth.md](auth.md) for adding IAM or API key auth.
