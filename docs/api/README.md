# REST API (API Gateway) — Phase 3

HTTP endpoints for Typst compilation via API Gateway. Deploy with `enableApiGateway: true` (default).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/compile` | Compile .typ source to PDF |
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
- `dataJson` — Base64-encoded JSON for template data

**Response (200):**
- `storeToS3: true` → `{ documentId, status: "completed", s3Url }`
- Default → `{ documentId, status: "completed", pdf: "<base64>" }`

**Limits:**
- Body size: 10MB
- Asset formats: PNG, JPEG, GIF, WebP, SVG (images); OTF, TTF, TTC (fonts)

## GET /documents/{id}

Returns document status: `{ documentId, status, s3_key?, error?, createdAt?, updatedAt? }`

## GET /documents/{id}/pdf

Returns presigned URL when PDF was stored in S3: `{ s3Url }`

## CORS

CORS is enabled by default. `Access-Control-Allow-Origin: *` for all responses.

## Authentication

No auth by default. See [auth.md](auth.md) for adding IAM or API key auth.
