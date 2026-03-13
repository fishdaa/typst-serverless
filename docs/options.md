# Options Matrix

All possible combinations of deployment, invocation, storage, and features. Use this as a quick reference.

---

## Deployment Targets

| Target | Entry Point | Docs |
|--------|-------------|------|
| **Container (Docker)** | `docker run` or `docker compose` | [container/](container/README.md) |
| **Lambda (SDK)** | AWS Lambda `InvokeCommand` | [lambda/](lambda/README.md) |
| **Lambda (REST API)** | HTTP `POST/GET` via API Gateway | [api/](api/README.md) |
| **ECR / ECS / EKS** | Container image in AWS | [ecr/](ecr/README.md) |

---

## Container Options

| Option | Storage | State | Output |
|--------|---------|-------|--------|
| Volume only | Named or bind mount | None | PDF to workspace |
| Volume + state | Named or bind mount | Local file in volume | PDF to workspace |
| Pipe only | None | None | PDF to stdout |
| Volume + pipe | Named or bind mount | None | Volume + stdout |
| Volume + state + pipe | Named or bind mount | Local file | Volume + stdout |

---

## Lambda / API Options

### Dimensions

| Dimension | Values | Notes |
|-----------|--------|-------|
| **Invocation** | Sync, Async | Sync = wait for response. Async = fire-and-forget, poll status. |
| **API Gateway** | Yes, No | Yes = REST. No = SDK only. |
| **DynamoDB** | Yes, No | Yes = persist state (document_id, status, s3_key); enables status, retrieve, async polling. No = sync inline only; no status/retrieve. |
| **S3 storage** | Yes, No | Yes = store output in S3; return presigned URL. No = return PDF inline (multipart) or status only. |
| **SQS** | Yes, No (Phase 5) | Yes = optional queue for batch + backpressure. No = direct Lambda invoke. |
| **Batch** | Yes, No | Compile multiple documents. |

### Rules

| Rule | Description |
|------|-------------|
| **DynamoDB required for async** | Async needs status/retrieve; DynamoDB stores state. |
| **DynamoDB required for batch** | Batch tracks each document; DynamoDB (with `batch_id`) stores state. |
| **DynamoDB optional for sync inline** | Sync single compile with PDF in response: no status/retrieve needed; Lambda-only stack possible. |
| **Batch requires SQS + S3** | Batch is only available when SQS is enabled AND S3 storage is enabled. |
| **Batch disabled for sync** | Sync path (direct Lambda invoke) does not support batch. |
| **Batch disabled without S3** | User must not opt out of S3; batch needs S3 for output storage. |
| **Async without batch** | Works with or without SQS. Single compiles use Lambda async invoke. |

### DynamoDB — when required

| Use case | DynamoDB |
|----------|----------|
| Sync, PDF inline | Optional (Lambda-only stack) |
| Sync, storeToS3 | Yes (retrieve by documentId) |
| Async (any) | Yes (status, retrieve, polling) |
| Batch | Yes (track each document, `batch_id` for batch status) |
| status / retrieve actions | Yes |

---

## Permutation Matrix (Lambda / API)

### Sync (single compile)

| API Gateway | S3 | SQS | Batch | Supported? | Output |
|-------------|-----|-----|-------|------------|--------|
| Yes | No | No | No | Yes | PDF inline (base64) |
| Yes | Yes | No | No | Yes | Presigned S3 URL |
| Yes | No | Yes | No | Yes | PDF inline |
| Yes | Yes | Yes | No | Yes | Presigned S3 URL |
| No | No | No | No | Yes | PDF inline |
| No | Yes | No | No | Yes | Presigned S3 URL |
| No | No | Yes | No | Yes | PDF inline |
| No | Yes | Yes | No | Yes | Presigned S3 URL |

### Async (single compile)

| API Gateway | S3 | SQS | Batch | Supported? | Flow |
|-------------|-----|-----|-------|------------|------|
| Yes | No | No | No | Yes | Invoke returns immediately; poll status; PDF via retrieve (if stored) or multipart |
| Yes | Yes | No | No | Yes | Invoke returns immediately; poll status; S3 presigned URL on completion |
| Yes | No | Yes | No | Yes | Same as no-SQS; SQS optional for single compiles |
| Yes | Yes | Yes | No | Yes | Same; SQS optional |
| No | No | No | No | Yes | Lambda async invoke |
| No | Yes | No | No | Yes | Lambda async invoke + S3 |
| No | No | Yes | No | Yes | Lambda async invoke |
| No | Yes | Yes | No | Yes | Lambda async invoke + S3 |

### Batch

| API Gateway | S3 | SQS | Batch | Supported? | Flow |
|-------------|-----|-----|-------|------------|------|
| Yes | No | No | Yes | **No** | Batch requires S3 |
| Yes | Yes | No | Yes | **No** | Batch requires SQS |
| Yes | No | Yes | Yes | **No** | Batch requires S3 |
| Yes | Yes | Yes | Yes | Yes | POST /batch → enqueue to SQS; 1 msg per doc; GET /batches/{id} for status |
| No | No | No | Yes | No | Batch requires S3 |
| No | Yes | No | Yes | No | Batch requires SQS |
| No | No | Yes | Yes | No | Batch requires S3 |
| No | Yes | Yes | Yes | Yes | Same; SDK or API enqueues; poll batch status |

---

## Quick Decision Tree

```
Need batch?
├── No  → Any combo of Sync/Async, S3, SQS, API Gateway
└── Yes → SQS + S3 required
          ├── POST /batch (or SDK) enqueues N messages
          ├── 1 Lambda per document
          └── GET /batches/{batchId} returns per-item status + S3 links

Need to avoid 429s under load?
└── Enable SQS → requests queue instead of failing

Need sync response (PDF in reply)?
└── Sync invoke, no SQS for single compile; batch not available

Need async (submit and poll)?
└── DynamoDB required; invoke or SQS; works with or without SQS for single compile

Need status / retrieve by documentId?
└── DynamoDB required

Sync only, PDF inline, no status/retrieve?
└── DynamoDB optional (Lambda-only minimal stack)
```

---

## Phase 5 Additions (SQS, Batch via SQS)

When SQS is enabled (TUI-guided, optional):

- **Batch** uses SQS: 1 message per document; 1 Lambda per message.
- **Batch status**: `GET /batches/{batchId}` returns per-item `status` and `s3Url` for completed items.
- **Single compile** continues to work via direct Lambda invoke (sync or async); SQS is not required for single compiles.
