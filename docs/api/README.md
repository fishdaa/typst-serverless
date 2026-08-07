# REST API (API Gateway) — Phase 3 & 4

HTTP endpoints for Typst compilation via API Gateway. Deploy with `enableApiGateway: true` (default).

**Full reference:** [docs/api-gateway-options.md](../api-gateway-options.md) — all endpoints, params, curl examples.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/compile` | Compile .typ source to PDF, SVG, or PNG (single or batch via `documents` array) |
| GET | `/status/{id}` | Get document or batch status; includes presigned `s3Url` when completed |
| POST | `/assets` | Upload (or register) a reusable asset, cached in S3 under a stable path |
| GET | `/assets` | List cached assets, optionally filtered by `?prefix=` |
| DELETE | `/assets/{path}` | Delete a cached asset |

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

**Per-document optional fields:** `main`, `extraTyps`, `fonts`, `assets`, `mainTypS3`, `mainTypAssetPath`, `outputS3`, `outputKey`, `outputFormat` (`pdf`|`svg`|`png`), `pdfStandard`, `webhook`, `data`, `dataFile`. See [api-gateway-options.md](../api-gateway-options.md) for full param reference.

Any `mainTypS3`, `fonts[]`/`assets[]`/`extraTyps[]` item, or `data` field that accepts `{ bucket, key }` also accepts `{ assetPath }` (or `mainTypAssetPath` for the main source) to reference a previously uploaded [cached asset](#post-assets) instead of a fresh S3 location — see below.

### Multipart form-data (single document)

One .typ file per request. Part names:

| Part name | Required | Description |
|-----------|----------|-------------|
| `main`, `mainTyp`, or `file` | Yes (one of) | The .typ source file (binary or text) |
| `extraTyp` / `extraTyps` | No | File part(s): additional .typ files for `#include()`. **Flat filenames only** — browsers/multipart parsers strip directory components from `filename`, so nested paths like `lib/module.typ` aren't preserved; use the JSON API's `extraTyps[].name` field for nested includes. |
| `documentId` | No | Form field: custom document ID |
| `storeToS3` | No | Form field: `true` or `1` to store output in S3 |
| `outputFormat` | No | Form field: `pdf`, `svg`, or `png` |
| `pdfStandard` | No | Form field: PDF variant (`a-2b`, `a-3b`, `1.4`, `1.5`, etc.); PDF only |
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

## POST /assets

Upload a reusable asset once (a font, image, `.typ` template, or data file) and reference it by path in future compile jobs — avoids re-sending the same bytes on every request.

**Request:** `application/json` or `multipart/form-data`.

```json
{ "assetPath": "brand/logo.png", "base64": "<base64>", "contentType": "image/png" }
```

- `assetPath` (required): the stable path assets are stored/looked-up under, e.g. `brand/logo.png` or `templates/report.typ`. No leading slash, no `..`, ASCII only.
- `base64`: the file content — uploads fresh bytes to the assets bucket. **Or**, instead of `base64`, provide `bucket`+`key` to register an existing S3 object under `assetPath` (server-side copy, no re-upload).
- `contentType` (optional).

Multipart form fields: file part `file`/`asset`; form fields `assetPath` (defaults to the uploaded filename), `contentType`.

**Response (200):** `{ assetPath }`.

**Requires** an assets bucket configured (`TYPST_ASSETS_BUCKET`, falling back to `TYPST_INPUT_BUCKET`); 503 if unset.

## GET /assets

Lists cached assets. Optional `?prefix=` query param filters by path prefix.

**Response (200):** `{ assets: [ { assetPath, size, lastModified } ] }`.

## DELETE /assets/{path}

Deletes a cached asset by path (URL-encode slashes as needed, or pass the full path as-is — the route captures the remainder greedily).

**Response (200):** `{ assetPath, deleted: true }`.

### Referencing a cached asset in /compile

```json
{
  "documents": [
    {
      "mainTypAssetPath": "templates/report.typ",
      "assets": [{ "name": "logo.png", "assetPath": "brand/logo.png" }],
      "fonts": [{ "name": "Brand-Regular.otf", "assetPath": "fonts/Brand-Regular.otf" }],
      "storeToS3": true
    }
  ]
}
```

## CORS

CORS is enabled by default. `Access-Control-Allow-Origin: *` for all responses.

## Authentication

No auth by default. See [auth.md](auth.md) for adding IAM or API key auth.
