# Lambda (AWS SDK) — Phase 2, 3 & 4

Deploy Typst compilation as an AWS Lambda function. Clients invoke via AWS SDK or REST API (API Gateway). State tracking in DynamoDB; optional S3 storage for output PDFs, SVG, or PNG.

## Architecture

```
Client (AWS SDK) → Lambda (Node.js + Typst Layer) → DynamoDB (state)
                                    ↓
                                 S3 (optional output)
```

## Publish Layer to Multiple Regions (CI)

A GitHub Action publishes the Typst layer to multiple regions on release or manual trigger:

1. Add **AWS credentials**:
   - **OIDC (recommended):** Set `AWS_ROLE_ARN` in Settings → Secrets and variables → Actions (Variables)
   - **Static:** Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Secrets

2. Run the workflow:
   - **Manual:** Actions → Publish Lambda Layer → Run workflow
   - **On release:** Create a release to trigger automatically

Publishes to: `us-east-1`, `us-east-2`, `us-west-1`, `us-west-2`, `ap-south-1`, `ap-northeast-1`, `ap-northeast-2`, `ap-southeast-1`, `ap-southeast-2`, `eu-central-1`, `eu-west-1`, `eu-west-2`, `eu-north-1`.

## Deploy

### Prerequisites

- Node.js 20+
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- AWS CLI configured with credentials

### One-click deploy

```bash
# 1. Install dependencies
npm install

# 2. Build Typst Lambda layer (downloads typst binary)
npm run build:layer

# 3. Build Lambda package
npm run build:lambda

# 4. Deploy
cd src/adapters/lambda-layer/pulumi
npm install
pulumi up
```

Or as a single command:

```bash
npm install && npm run build:layer && npm run build:lambda && \
  cd src/adapters/lambda-layer/pulumi && npm install && pulumi up
```

### Configuration

- `s3RetentionDays` — S3 lifecycle rule for output PDFs (default: 7)
- `enableApiGateway` — Enable REST API (default: true)
- `enableSqs` — Enable SQS for parallelized batch (Phase 5, default: false)

**Interactive setup (TUI):**

```bash
npm run deploy:tui
```

Prompts for API Gateway, SQS, S3 retention, and customer buckets. Then run `npm run build:lambda && npm run deploy:lambda`.

```bash
pulumi config set enableSqs true
pulumi config set s3RetentionDays 14
```

## Usage

### Compile (inline source, return PDF)

```javascript
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "compile",
    mainTyp: Buffer.from("#set page(width: 100pt)\nHello!").toString("base64"),
  }),
}));

const result = JSON.parse(new TextDecoder().decode(Payload));
// result.pdf = base64-encoded PDF
// result.documentId = for status/retrieve
```

### Compile (store to S3, get presigned URL)

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "compile",
    mainTyp: Buffer.from("#hello\n").toString("base64"),
    storeToS3: true,
  }),
}));

const result = JSON.parse(new TextDecoder().decode(Payload));
// result.s3Url = presigned download URL
// result.documentId = for status/retrieve
```

### Compile (source from S3)

Upload your `main.typ` to the input bucket first, then:

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "compile",
    mainTypS3: {
      bucket: "typst-input-xxx",  // from pulumi outputs
      key: "my-doc/main.typ",
    },
    storeToS3: true,
  }),
}));
```

### Status

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "status",
    documentId: "doc-123",
  }),
}));

const result = JSON.parse(new TextDecoder().decode(Payload));
// result.status = "pending" | "compiling" | "completed" | "failed"
```

### Retrieve (when stored in S3)

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "retrieve",
    documentId: "doc-123",
  }),
}));

const result = JSON.parse(new TextDecoder().decode(Payload));
// result.s3Url = presigned URL to download PDF
```

## Event schema

| Field | Required | Description |
|-------|----------|-------------|
| action | No | `compile` (default), `status`, `retrieve`, `batch` |
| mainTyp | Yes (compile) | Base64-encoded .typ source |
| mainTypS3 | Yes (compile) | `{ bucket, key }` — must use input bucket |
| main | No | Main .typ filename (default `main.typ`); e.g. `document.typ`, `src/report.typ` |
| storeToS3 | No | If true, store output in S3; return presigned URL |
| outputFormat | No | `pdf` (default), `svg`, or `png` |
| pdfStandard | No | PDF standard: `a-2b`, `a-3b`, `1.4`, `1.5`, etc. (PDF only) |
| webhook | No | `{ url: "https://..." }` — POST completion/failure to your endpoint |
| documentId | No (compile) | Custom ID; generated if omitted |
| documentId | Yes (status/retrieve) | Document to query |
| documents | Yes (batch) | Array of compile events (each with mainTyp or mainTypS3) |

## REST API (Phase 3)

When API Gateway is enabled (default), you can call the same logic via HTTP:

```bash
export API_URL=$(pulumi stack output apiUrl)
curl -X POST "$API_URL/compile" \
  -H "Content-Type: application/json" \
  -d '{"mainTyp":"'$(echo -n '#set page(width: 100pt)\nHello!' | base64)'","storeToS3":true}'
```

See [docs/api/](../api/README.md) for full REST API documentation.

## Phase 3: Fonts, assets, customer S3

- **fonts** — `[{ name: "fonts/custom.otf", base64: "..." }]` or S3 refs (OTF, TTF, TTC)
- **assets** — `[{ name: "logo.png", base64: "..." }]` (PNG, JPEG, GIF, WebP, SVG)
- **outputS3** — Customer-owned bucket: `{ bucket: "my-bucket", keyPrefix: "pdfs/" }`

Configure `customerOutputBuckets` in Pulumi for IAM access to customer S3.

## Phase 4: Output variants, webhooks, batch

- **outputFormat** — `"pdf"` (default), `"svg"`, or `"png"`
- **pdfStandard** — For PDF output: `"a-2b"`, `"a-3b"`, `"1.4"`, `"1.5"`, etc.
- **webhook** — `{ url: "https://your-endpoint.com/cb" }` — Lambda POSTs `{ documentId, status, s3Url?, pdf?, error? }` on completion or failure. URL must be HTTPS.
- **batch** — `action: "batch"`, `documents: [{ mainTyp, storeToS3 }, ...]` — Compile multiple documents; returns `{ results: [...] }` (sequential) or `{ batchId, documentIds }` when SQS enabled (Phase 5).
- **data** — Base64 content or `{ bucket, key }` — Template data written to workDir. **dataFile** (default `data.json`) sets the filename; allowed extensions: .json, .yaml, .yml, .toml, .csv, .xml, .cbor. Use the matching Typst function in your template (`json()`, `yaml()`, `toml()`, etc.).

## Phase 5: SQS, batch via queue, batch status

When `enableSqs: true`:

- **Batch via SQS:** `POST /batch` with `storeToS3: true` enqueues 1 message per document. Returns `{ batchId, documentIds }`. Each document compiles in a separate Lambda invocation.
- **Batch status:** `GET /batches/{batchId}` returns `{ results: [{ documentId, status, s3Url?, error? }, ...] }`.
- **Batch disable rules:** Batch via SQS requires SQS + S3; disabled for sync path or when S3 is not configured.

### Example: compile with webhook

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "compile",
    mainTyp: Buffer.from("#hello\n").toString("base64"),
    storeToS3: true,
    webhook: { url: "https://api.example.com/typst-callback" },
  }),
}));
// Webhook receives POST on completion: { documentId, status: "completed", s3Url }
```

### Example: batch compile

```javascript
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: "typst-compile-xxx",
  Payload: JSON.stringify({
    action: "batch",
    documents: [
      { mainTyp: Buffer.from("#doc1\n").toString("base64") },
      { mainTyp: Buffer.from("#doc2\n").toString("base64"), storeToS3: true },
    ],
  }),
}));
const result = JSON.parse(new TextDecoder().decode(Payload));
// result.results = [{ documentId, status }, { documentId, status, s3Url }]
```

## LocalStack testing

Run Lambda E2E tests against [LocalStack](https://localstack.cloud/) (no real AWS):

```bash
localstack start
./scripts/localstack-setup.sh   # Creates DynamoDB table + S3 buckets
npm run test:localstack
```

**Sync mode** (no DynamoDB): `TYPST_USE_IN_MEMORY_STATE=1`. Compile → immediate response. Lambda only (inline) or lambda + S3.

**Async mode** (DynamoDB + S3): status, retrieve, full workflow.

Both modes run via `npm run test:localstack` (part of `npm test`).

## Limits

- **Payload size:** 6MB sync, 256KB async; 10MB for REST API
- **S3 key:** No path traversal (`..`), ASCII only
- **document_id:** 1–128 chars, alphanumeric, hyphens, underscores
