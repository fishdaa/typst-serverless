# REST API (API Gateway) — Phase 3 & 4

HTTP endpoints for Typst compilation via API Gateway. Deploy with `enableApiGateway: true` (default).

**Full reference:** [docs/api-gateway-options.md](../api-gateway-options.md) — all endpoints, params, curl examples.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/compile` | Compile .typ source to PDF, SVG, or PNG (single or batch via `documents` array) |
| GET | `/status/{id}` | Get document or batch status; includes presigned `s3Url` when completed |
| POST | `/assets` | Upload (or register) a reusable asset, cached in S3 under a stable path |
| POST | `/assets/presign` | Presign direct-to-S3 upload URL(s) for the persistent asset library |
| POST | `/uploads` | Presign direct-to-S3 upload URL(s) for ephemeral, job-scoped compile inputs |
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

**Per-document optional fields:** `main`, `extraTyps`, `fonts`, `assets`, `mainTypS3`, `mainTypAssetPath`, `mainTypUploadRef`, `outputS3`, `outputKey`, `outputFormat` (`pdf`|`svg`|`png`), `pdfStandard`, `webhook`, `data`, `dataFile`. See [api-gateway-options.md](../api-gateway-options.md) for full param reference.

Any `mainTypS3`, `fonts[]`/`assets[]`/`extraTyps[]` item, or `data` field that accepts `{ bucket, key }` also accepts `{ assetPath }` (or `mainTypAssetPath` for the main source) to reference a previously uploaded [cached asset](#post-assets), or `{ uploadRef: { jobId, name } }` (or `mainTypUploadRef`) to reference an [ephemeral presigned upload](#large-inputs-presigned-direct-to-s3-uploads) — see below.

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

## Large inputs: presigned direct-to-S3 uploads

Presigning is **optional** — one of several ways to get bytes in. Pick by size and reuse:

| Input path | Send bytes as | Good for | Ceiling |
|------------|---------------|----------|---------|
| Inline `mainTyp` / `assets[].base64` | base64 in the request body | small sources, a logo | ~7MB of raw bytes before the 10MB body limit |
| `multipart/form-data` on `/compile` | raw file parts | avoiding base64 on the client | same 10MB body limit |
| `POST /assets` (base64 or `bucket`+`key`) | base64, or register an existing S3 object | building the reusable library | same 10MB body limit |
| `{ bucket, key }` refs | nothing — object already in S3 | objects your own pipeline wrote | none |
| **`POST /assets/presign` / `POST /uploads`** | client `PUT`s straight to S3 | anything large, and **all** large async inputs | `TYPST_MAX_UPLOAD_BYTES` (default 256MB) |

Request bodies are capped: **10MB** at API Gateway, **6MB** for a direct sync Lambda invoke, and **256KB** for an async one. Base64 inflates bytes by ~33%, so anything past a few MB — a print-resolution poster background, a large font, a big data file — must go straight to S3 instead of through the request body. Presign an upload URL, `PUT` the bytes to S3 from the client, then reference the object by path in `/compile` or `/batch`.

Two namespaces, same mechanism, different lifetime:

| Endpoint | Key | Lifetime | Use for |
|----------|-----|----------|---------|
| `POST /assets/presign` | `assets/<assetPath>` | Permanent | Reusable library assets — brand logos, fonts, templates |
| `POST /uploads` | `uploads/<jobId>/<name>` | Expired by an S3 lifecycle rule (`uploadRetentionDays`, default 1 day) | One-off inputs for a single job |

Both work identically for **sync** (`/compile`) and **async** (`/batch`) compiles. For async, presigning is not just an optimization — the 256KB async payload limit makes it the only way to pass a large input.

### POST /assets/presign

```json
{ "assetPath": "brand/logo.png", "contentType": "image/png", "sizeBytes": 184320 }
```

Batch form — sign up to 100 uploads in one call:

```json
{ "assets": [
  { "assetPath": "brand/logo.png", "contentType": "image/png", "sizeBytes": 184320 },
  { "assetPath": "brand/bg.svg", "contentType": "image/svg+xml", "sizeBytes": 9210 }
] }
```

`contentType` and `sizeBytes` are **required**: both are signed into the URL, so a leaked URL can only write that content type at that exact byte length. `sizeBytes` must not exceed `TYPST_MAX_UPLOAD_BYTES` (default 256MB). `assetPath` must end in an extension the compiler can consume (`.typ`, data files, images, fonts) — note that `POST /assets`, which writes through the Lambda rather than handing out a URL, does not enforce that allowlist.

> **Changed:** earlier versions signed a URL from `{ assetPath }` alone, with `contentType` optional and no size or extension check. Such a URL was an unbounded write of arbitrary content into the bucket for its whole lifetime. A caller that sends only `assetPath` now gets a `400`. To migrate, add the two fields — a browser has both on the `Blob` (`blob.size`, `blob.type`) — and echo the returned `headers` on the `PUT`. Response fields are unchanged apart from additions.

**Response (200):** `{ assetPath, uploadUrl, contentType, sizeBytes, headers, expiresAt }` — or `{ uploads: [...], expiresAt }` for the batch form.

### POST /uploads

```json
{
  "files": [
    { "name": "main.typ", "contentType": "text/plain", "sizeBytes": 812 },
    { "name": "bg-0.png", "contentType": "image/png", "sizeBytes": 48211900 }
  ]
}
```

Optional `jobId` reuses an existing job namespace; otherwise one is minted.

**Response (200):** `{ jobId, uploads: [ { name, uploadRef, uploadUrl, contentType, sizeBytes, headers } ], expiresAt, maxUploadBytes }`.

### Uploading

`PUT` the bytes to `uploadUrl`, echoing back the `headers` from the response verbatim — they are part of the signature:

```js
await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: blob })
```

### Referencing the upload

Library assets use `assetPath` (see [below](#referencing-a-cached-asset-in-compile)). Job uploads use `uploadRef`, accepted anywhere `assetPath` is — plus `mainTypUploadRef` for the main source:

```json
{
  "documents": [
    {
      "mainTypUploadRef": { "jobId": "3f1b…", "name": "main.typ" },
      "assets": [{ "name": "background.png", "uploadRef": { "jobId": "3f1b…", "name": "bg-0.png" } }],
      "data": { "uploadRef": { "jobId": "3f1b…", "name": "rows.json" } },
      "storeToS3": true
    }
  ]
}
```

Every referenced object is `HEAD`-checked before compiling, so an upload that never completed returns **400** naming the missing keys — on `/batch` that check runs at enqueue time, before any message reaches the queue.

**CORS:** the assets bucket allows `PUT`/`HEAD`/`GET` from the origins in the `uploadAllowedOrigins` stack config (default `*` — narrow it in production) and exposes `ETag`.

**Live example:** the **Presigned Uploads** tab of the [demo app](../../demo/) runs both flows end to end in the browser, including the missing-upload `400`.

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
