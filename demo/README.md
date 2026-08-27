# typst-serverless demo

A live, browser-driven demo of every feature the typst-serverless API supports:
quick compile, multipart file upload, multi-file `#import` projects, JSON data
binding, output formats (pdf/svg/png) and PDF standards, async compile + status
polling, SQS-backed batch compile, presigned direct-to-S3 uploads, cached
templates + assets driven by per-document data, and webhooks.

It's a static Nuxt (Vue) SPA — no server at runtime — that calls the deployed
API directly from the browser. Hosting is S3 (private) + CloudFront (Origin
Access Control), both provisioned via Pulumi in [`pulumi/`](pulumi/).

## Prerequisites

- `devbox shell` from the repo root (provides `pulumi`, `awscli2`, `node`).
- AWS SSO session: `aws sso login --profile typst-serverless`.
- The backend stack (`src/adapters/lambda-layer/pulumi`, stack `demo`) already
  deployed — this demo calls its `apiUrl` output.

## Deploy

```bash
# 1. Backend (once, from repo root) — skip if already deployed
cd src/adapters/lambda-layer/pulumi
pulumi stack select demo
npm run build:layer && npm run build:lambda   # from repo root
pulumi up

# 2. Build the frontend against the live API
cd ../../../../demo
npm install
NUXT_PUBLIC_API_BASE=$(cd ../src/adapters/lambda-layer/pulumi && pulumi stack output apiUrl) \
  npm run generate

# 3. Deploy hosting (S3 + CloudFront) and sync the build output
cd pulumi
npm install
pulumi stack select demo
pulumi up
pulumi stack output demoUrl
```

CloudFront distributions take a few minutes to reach `Deployed` status after
the first `pulumi up` — the URL will 403/504 until then.

Whenever the demo content changes, redo step 2 and re-run `pulumi up` in
`demo/pulumi` to resync — the `S3BucketFolder` component diffs the built
files and only uploads what changed.

CloudFront caches responses for up to 5 minutes (`defaultTtl: 300`), so
updated content may not appear immediately. To see changes right away,
invalidate the distribution after `pulumi up`:

```bash
DIST_ID=$(pulumi stack output distributionId)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

## Local development

Point a local dev server at the deployed backend:

```bash
cd demo
NUXT_PUBLIC_API_BASE=$(cd ../src/adapters/lambda-layer/pulumi && pulumi stack output apiUrl) \
  npm run dev
```

## Notes

- The **Presigned Uploads** tab exercises both presign endpoints end to end
  (`POST /uploads` for ephemeral job inputs, `POST /assets/presign` for the
  persistent library), including the 400 you get when a compile references an
  upload whose `PUT` never happened. It needs the browser to reach S3 directly,
  which the backend's input-bucket CORS rule allows (`uploadAllowedOrigins`,
  default `*` — narrow it and the demo origin must be included).
- **Posters** presigns every background in one `POST /uploads` call and uploads
  them as ephemeral job inputs, so demo runs don't accumulate in the asset
  library. **Asset Library** uses base64 under 4MB and a presigned direct PUT
  above it.
- **Cached Campaign** is the inverse of Posters: the background PNG, the logo and
  the poster template are presigned into the *persistent* library once
  (`POST /assets/presign`), then every compile references them by `assetPath`
  and carries only its own `poster.json` via `data` + `dataFile`. A four-poster
  batch enqueues in ~1.4KB of JSON. Caches are listed back from
  `assets/campaign/` so one staged in an earlier session can be reused without
  re-uploading; the geometry is encoded in the cache id because the template
  hard-codes the page size. Deleting a cache and re-enqueuing shows the
  enqueue-time 400 — `assetPath` references are HEAD-checked before anything
  reaches SQS.
- The batch (SQS) tab requires the backend stack to have `enableSqs: true`
  set (`pulumi config set enableSqs true` in the backend's pulumi dir) — this
  demo stack has it on.
- CORS on the API Gateway is `*` (see `corsConfiguration` on the backend's
  `aws.apigatewayv2.Api`), so the browser can call it directly with no proxy.
- Sample assets (`public/samples/logo.png`, `public/samples/Roboto-Bold.ttf`)
  are copied from `test/fixtures/` for demo content only — no code coupling
  to the test suite.

## Teardown

```bash
cd demo/pulumi && pulumi destroy
cd ../../src/adapters/lambda-layer/pulumi && pulumi destroy
```

Destroying the backend stack also deletes the S3 buckets used for compiled
output and cached assets, and the DynamoDB state table.
