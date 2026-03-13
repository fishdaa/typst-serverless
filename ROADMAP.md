# Typst Serverless — Project Roadmap

## Overview

**Phase 1:** Docker packaging with internal state tracking.  
**Phase 2:** Lambda + DynamoDB (MVP features).  
**Phase 3:** Fonts, assets, API Gateway, and S3 delivery.  
**Phase 4:** Output variants, webhooks, and batch jobs.

**Architecture principle:** Core codebase is output-agnostic. Same compilation logic runs as containerized (Docker), Lambda (Node.js + Typst Layer), or via ECR (ECS, EKS).

**One-click deploy:** Single-command deployment to AWS (Lambda, DynamoDB, S3, optionally API Gateway) with sensible defaults.

---

## Status (Completed)

| Phase | Milestone | Status |
|-------|-----------|--------|
| **Phase 1** | 1.1 Testing — Core unit tests (validate, state), container integration | ✅ |
| | 1.2 Dockerfile — Base on Typst image | ✅ |
| | 1.3 docker-compose.yml — Profiles (volume, volume-state, pipe, volume-pipe) | ✅ |
| | 1.4 src/core + adapters — Core (compile, state, validate); container (CLI); lambda-layer | ✅ |
| | 1.5 Storage — Named volume, bind mount | ✅ |
| | 1.6 adapters/container, adapters/lambda-layer | ✅ |
| | 1.7 README.md — Build and usage instructions | ✅ |
| | 1.8 Docs — getting-started, container, integrations (Node, Python, Go, PHP, Ruby) | ✅ |
| **Phase 2** | 2.1 Lambda integration tests — validation (schema, size, S3 keys) | ✅ |
| | 2.2 Pulumi — Lambda, DynamoDB, S3, lifecycle rules | ✅ |
| | 2.3 Lambda handler — compile, status, retrieve; multipart; optional S3 | ✅ |
| | 2.4 DynamoDB table — document_id PK, status, s3_key, timestamps | ✅ |
| | 2.5 IAM role — DynamoDB, S3, CloudWatch Logs | ✅ |
| | 2.7 Docs — lambda branch, integrations with Lambda examples | ✅ |
| | 2.8 One-click deploy — `npm run build:lambda` + `pulumi up` | ✅ |
| | 2.9 LocalStack verification — E2E Lambda tests against LocalStack | ✅ |
| | 2.10 Multi-region layer publish — CI publishes Typst layer to multiple AWS regions | ✅ |
| **Phase 3** | 3.1 Testing — Param-format, asset validation, REST validation | ✅ |
| | 3.2 Fonts/assets — Custom fonts, image injection, asset validation | ✅ |
| | 3.3 API Gateway — REST API, request validation | ✅ |
| | 3.4 S3 delivery — Customer-owned S3 destination | ✅ |
| | 3.5 Docs — docs/api/, auth.md, integrations REST examples | ✅ |
| **Phase 4** | 4.1 Testing — E2E webhooks, batch, output variants | ✅ |
| | 4.2 Output options — PDF variants (--pdf-standard), SVG/PNG | ✅ |
| | 4.3 Webhooks — POST completion/failure to user URL | ✅ |
| | 4.4 Batch — Multi-document compile flows | ✅ |
| | 4.5 Docs — api/, lambda/, integrations webhook & batch patterns | ✅ |
| **Tooling** | TypeScript, Vitest, build (tsc), Tests to TS, ESLint (linting), Devbox (dev shell) | TypeScript+Vitest ✅; Tests to TS pending; ESLint pending; Devbox ✅ |

Phase 4 complete. ECR (2.6) is deferred. Tooling (TypeScript, Vitest) complete.

### Proof (tests & example code)

| Milestone | Proof |
|-----------|-------|
| **1.1** | Tests: `test/core/validate.test.js`, `test/core/state.test.js`, `test/core/compile.test.js`, `test/integration/container.test.js`. Fixtures: `test/fixtures/*.typ`. Run: `npm run test` (core), `npm run test:integration` (container). |
| **1.2** | `Dockerfile` — `FROM ghcr.io/typst/typst:0.14.2`. Run: `docker build -t typst-serverless .`. |
| **1.3** | `docker-compose.yml` — profiles `volume`, `volume-state`, `pipe`, `volume-pipe`. Run: `docker compose --profile volume run typst`. |
| **1.4** | Source: `src/core/compile.js`, `src/core/state.js`, `src/core/validate.js`; `src/adapters/container/cli.js`; `src/adapters/lambda-layer/handler.js`, `resolve-input.js`. |
| **1.5** | `test/integration/container.test.js` — volume mode uses bind mount (`-v`); `docker-compose.yml` defines `typst-workspace` volume. |
| **1.6** | `src/adapters/container/` (cli.js, entrypoint.sh, pulumi/); `src/adapters/lambda-layer/` (handler.js, resolve-input.js, pulumi/). |
| **1.7** | `README.md` — Quick Start, build/run commands, env vars, Docker Compose. |
| **1.8** | `docs/getting-started.md`; `docs/container/README.md`; `docs/integrations/` (node-express.md, node-fastify.md, python-flask.md, python-fastapi.md, go.md, php.md, ruby.md). |
| **2.1** | `test/integration/lambda.test.js` — validates payload size, event schema, S3 key path traversal, documentId. Run: `npm run test:lambda`. |
| **2.2** | `src/adapters/lambda-layer/pulumi/index.ts` — Lambda, DynamoDB table, S3 buckets, lifecycle rules. |
| **2.3** | `src/adapters/lambda-layer/handler.js` — actions: compile, status, retrieve; multipart response; S3 storage via `storeToS3`. |
| **2.4** | Pulumi `aws.dynamodb.Table` hashKey `document_id`; handler uses `createDynamoDBState` with `status`, `s3_key`, timestamps. |
| **2.5** | Pulumi: `aws.iam.Role`, `RolePolicyAttachment` (basic), `RolePolicy` (DynamoDB, S3 Get/Put). |
| **2.7** | `docs/lambda/README.md` — deploy, invoke, S3; `docs/integrations/*.md` — Lambda SDK examples (e.g. `node-fastify.md` "Lambda (AWS SDK)" section). |
| **2.8** | `package.json`: `build:lambda`, `deploy:lambda`; `docs/lambda/README.md` "One-click deploy" section with `npm run build:lambda` + `pulumi up`. |
| **2.9** | `test/integration/localstack.test.ts` — sync mode (TYPST_USE_IN_MEMORY_STATE; lambda only, lambda+S3) and async mode (DynamoDB + S3: status, retrieve, workflow). `scripts/localstack-setup.sh`, `scripts/test-localstack.sh`. Run: `localstack start && ./scripts/localstack-setup.sh && npm run test:localstack`. |
| **2.10** | `.github/workflows/publish-lambda-layer.yml` — publishes layer to multiple regions; `docs/lambda/README.md` "Publish Layer to Multiple Regions (CI)" section. |
| **3.1** | `test/core/assets.test.js`, `test/integration/api.test.js` — asset validation, REST event parsing, 10MB limit. |
| **3.2** | `src/core/assets.js` — `validateAssetKey`, `validateAssetRef`, `validateAssets`; `resolve-input.js` — fonts/assets; handler validates before compile. |
| **3.3** | `src/adapters/lambda-layer/api-handler.js`, `index.js`; Pulumi: API Gateway HTTP API, routes POST /compile, GET /documents/{id}, GET /documents/{id}/pdf. |
| **3.4** | Handler: `outputS3: { bucket, keyPrefix }`; Pulumi `customerOutputBuckets` config for IAM. |
| **3.5** | `docs/api/README.md`, `docs/api/auth.md`; `docs/getting-started.md`, `docs/lambda/README.md`, `docs/integrations/node-fastify.md` updated. |
| **4.1** | `test/integration/webhooks-batch.test.js` — output variants, webhooks, batch validation. Run: `npm run test:integration`. |
| **4.2** | `src/core/compile.js` — `format` (pdf/svg/png), `pdfStandard` (a-2b, a-3b, etc.); handler passes through `outputFormat`, `pdfStandard`. |
| **4.3** | Handler: `webhook.url` validation; `invokeWebhook()` POSTs on completion/failure; `validateWebhookUrl` (HTTPS only). |
| **4.4** | Handler: `action: "batch"`, `validateBatchEvent`; processes `documents` array; API handler `POST /batch`. |
| **4.5** | `docs/api/README.md` — outputFormat, pdfStandard, webhook, POST /batch; `docs/lambda/README.md` Phase 4 section. |

---

## Tooling (Status & Next Steps)

**Goal:** Improve DX with TypeScript, Vitest, and a consistent dev environment, then tighten the toolchain (linting, bundling).

| Item | Description |
|------|-------------|
| **TypeScript** | `tsconfig.json` added; `src/` migrated to `.ts`; `npm run build` uses `tsc` to emit to `dist/`; `build-lambda-package.js` copies compiled output from `dist/`. |
| **Vitest** | Node `node:test` runner replaced with Vitest; `vitest.config.ts` added; `npm test`, `npm run test:core`, `npm run test:integration`, `npm run test:lambda`, `npm run test:localstack` run the suite. |
| **Tests to TS** | **Next:** gradually migrate `test/` files from `.js` to `.ts` and import directly from `src/` (Vitest handles TS); remove any remaining `dist/` import indirection. |
| **Build/bundler** | **Next:** keep `tsc` as the source of truth emitting to `dist/`; optionally introduce a bundler for Lambda (Rollup or Vite today; Rolldown later when stable) for smaller artifacts. |
| **Linting** | **Next:** add ESLint with TypeScript-aware rules, an `npm run lint` script, and CI integration. |
| **Devbox** | [Devbox](https://github.com/jetify-com/devbox) dev shell with Typst and Node.js; `devbox shell` gives a reproducible environment for `npm test` (including compile tests) without system-wide Typst. |

**Suggested order from here:** Tests to TS → Linting (ESLint + CI) → bundler (Rollup or Vite; Rolldown when stable). Scripts and Lambda handler should continue to point at compiled output in `dist/`.

---

## Core: Multi-Output Architecture

**Goal:** One core, multiple deployment outputs. Core logic is shared; thin adapters handle runtime differences.

| Output | Description |
|--------|-------------|
| Containerized | Docker image; configurable features; see options below |
| AWS Serverless | Lambda Node.js runtime + Typst Layer (zip); configurable components; see options below |
| ECR | Push container image to ECR; consumable by ECS, EKS (optional Lambda container) |

**Container deployment options:**

| Option | Storage | State | Output | Description |
|--------|---------|-------|--------|-------------|
| Container + volume | Named or bind | None | Write to volume | Compile; output PDF to /workspace |
| Container + volume + state | Named or bind | Local file in volume | Write to volume | Optional job/state tracking in volume |
| Container + pipe | None | None | Stdout | Pipe PDF to stdout (e.g. `docker run ... > out.pdf`) |
| Container + volume + pipe | Named or bind | None | Volume + stdout | Write to volume and stream to stdout |
| Container + volume + state + pipe | Named or bind | Local file | Volume + stdout | Full configuration |

Storage: named volume (internal) or bind mount (user-defined folder). Pulumi/docker-compose profiles per configuration.

**AWS Serverless deployment options:**  
Lambda uses **Node.js runtime**; Typst binary in Layer; zip deployment (no container image).

| Option | Components | Mode | Description |
|--------|------------|------|-------------|
| Lambda + API Gateway + DynamoDB + S3 | Lambda, API GW, DynamoDB, S3 | Sync / REST | REST endpoints; store PDF in S3; state in DynamoDB |
| Lambda + DynamoDB + S3 | Lambda, DynamoDB, S3 | Async | Store PDF to S3; state tracking in DynamoDB; invoke via SDK |
| Lambda + DynamoDB | Lambda, DynamoDB | Async | State tracking only; return PDF inline (multipart) |
| Lambda + S3 | Lambda, S3 | Sync | Store PDF to S3; return presigned URL; no DynamoDB |
| Lambda only | Lambda | Sync | Return PDF as multipart; no persistence |
| Lambda + API Gateway | Lambda, API GW | Sync | REST endpoints; return PDF as multipart; no DynamoDB, no S3 |
| Lambda + API Gateway + S3 | Lambda, API GW, S3 | Sync | REST; store PDF in S3; return presigned URL |
| Lambda + API Gateway + DynamoDB | Lambda, API GW, DynamoDB | Sync/Async | REST; state in DynamoDB; return multipart |

Pulumi in `adapters/lambda-layer/pulumi/` supports multiple stacks (lambda-only, lambda-dynamodb, lambda-api, etc.).

Pulumi/docker-compose in `adapters/container/` supports profiles (e.g. `volume-only`, `volume-state`, `pipe`, `volume-pipe`) for each container configuration.

**Structure:**
```
src/
├── core/           # Platform-agnostic: compile(), state interface
└── adapters/
    ├── container/      # Docker entrypoint, volume handling
    │   └── pulumi/     # Pulumi for container deployment
    ├── lambda-layer/   # Lambda Node.js runtime + Typst Layer (zip)
    │   └── pulumi/     # Pulumi: Lambda, Layer, DynamoDB, S3, same configurations
    └── ecr/            # (Optional) Pulumi for ECR + ECS/EKS; container image for ECS/EKS
```

- **core/** — Typst compile logic, abstract state interface (in-memory for local, DynamoDB for AWS).
- **adapters/container** — CLI/entrypoint; configurable storage, state, output; Pulumi/docker-compose profiles per configuration.
- **adapters/lambda-layer** — Lambda **Node.js runtime**; Typst binary in Layer; handler invokes core; Pulumi deploys Lambda, Layer, DynamoDB, S3.
- **adapters/ecr** — Pulumi for ECR; container image for ECS/EKS (not Lambda).

**IaC:** Each adapter has its own Pulumi project (`adapters/*/pulumi/`) for independent, easy deployment.

**Documentation (`docs/`):**

| File | Description |
|------|-------------|
| `docs/getting-started.md` | Entry point; branches to use-case-specific sections |
| `docs/container/` | Docker / container use cases (volume, pipe, state) |
| `docs/integrations/` | Language/framework guides (Node, Python, Go, PHP, Ruby). **Updated per phase** — each phase adds integration patterns for the new output (container → Lambda SDK → REST API). |
| `docs/lambda/` | Lambda (SDK) use cases (sync, async, S3, DynamoDB) |
| `docs/api/` | REST / API Gateway use cases (Phase 3); includes optional auth setup guide |
| `docs/ecr/` | ECR / ECS / EKS use cases (optional) |

Getting started flow: user selects use case (container, Lambda, REST API, ECR) → links to relevant branch section. Each branch covers setup, input formats, and output handling for that use case. Integrations docs mirror available outputs and are expanded as each phase ships. Docs milestones per phase below.

**Input parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| main.typ | Yes | Source document; multipart if REST |
| custom fonts | No | Use Typst default fonts if not provided |
| assets | No | Images, logos, etc.; validated to Typst-supported types only (PNG, JPEG, GIF, WebP, SVG; supported fonts) |
| data.json | No | JSON data for template binding |

**Param formats:** S3 keys (per file), S3 folder (main.typ path defined; `data.json` default if present in folder), base64, or inline.

**Request validations (Lambda / API Gateway):**

| Validation | Lambda | API Gateway | Description |
|------------|--------|-------------|-------------|
| Payload/body size | 6MB sync, 256KB async | 10MB (REST API) | Reject oversized requests; return 413/400 with clear error |
| Event/body schema | Required | Optional JSON Schema | Validate structure; required fields (main.typ or S3 ref); reject malformed |
| document_id format | On status/retrieve | Path param `:id` | Validate ID format; return 400/404 for invalid |
| S3 key validation | Yes | Yes | Reject path traversal (`../`); valid key charset; bucket scope |
| Content-Type | N/A | multipart vs application/json | Validate per endpoint; reject unsupported |
| Rate limiting | Concurrency (Lambda) | Usage plans, throttling | Configurable limits; 429 when exceeded |
| Input sanitization | Yes | Yes | Reject invalid chars, oversized strings; fail fast |

**Parameter passing by mode:**

| Mode | How to pass main.typ, fonts, assets, data.json |
|------|------------------------------------------------|
| **REST** | Multipart form; or JSON body with S3 keys, S3 folder, base64, or inline |
| **Lambda (SDK)** | Event payload: S3 keys, S3 folder (main.typ + optional data.json), base64, or inline JSON |
| **Container** | Volume (files in workspace); or S3 keys/folder if AWS creds available; or stdin/base64/env for inline |

---

## Testing

**Principle:** Write tests first. Define test specs, fixtures, and integration cases at the start of each phase; implement features to satisfy them.

**Core (`src/core`):**
- Unit tests — compile logic, input parsing, state interface (Vitest)
- Typst fixtures — minimal `.typ` inputs; assert compile success or PDF output

**Adapters:**
- **Container** — `docker run` against built image; volume and pipe modes; verify output PDF
- **Lambda** — SAM Local, LocalStack, or `lambda-local`; mock events; assert response

**Param formats:**
- S3 keys — mock S3 or LocalStack/MinIO
- Base64 / inline — unit tests for parser
- S3 folder — integration with mock S3 layout

**E2E (Phase 3):** REST tests against API Gateway (or local HTTP) with multipart uploads

| Phase | Testing scope |
|-------|---------------|
| 1 | Core unit tests; container integration tests |
| 2 | Lambda integration tests — validation (schema, size, S3 keys); **LocalStack E2E** — sync (in-memory) and async (DynamoDB + S3) modes; no real AWS |
| 3 | Param-format tests; request validation (size, schema, path); E2E for REST (API Gateway) |
| 4 | E2E for webhooks and batch |

---

## Phase 1: Docker Packaging

**Goal:** Build a Docker image for containerized use; Lambda uses Node.js runtime + Typst Layer (separate deployment). Includes internal state tracking for container; Lambda uses DynamoDB.

**Approach:** Extend `ghcr.io/typst/typst:0.14.2` for container; for Lambda, use Node.js runtime + Typst Layer.

| Milestone | Deliverables |
|-----------|--------------|
| 1.1 | Testing — Core unit test spec and Typst fixtures; container integration test cases (write first) |
| 1.2 | `Dockerfile` — Base on Typst image, copy fonts/templates; Lambda uses separate Node + Layer |
| 1.3 | `docker-compose.yml` — Profiles for container configurations: volume, state, pipe, volume+pipe |
| 1.4 | `src/core` + adapters — Core; container (CLI); lambda-layer (Node.js + Typst Layer) |
| 1.5 | Storage — Support both named volume (default) and bind mount (user-defined folder) |
| 1.6 | Core + adapters — `adapters/container`, `adapters/lambda-layer` |
| 1.7 | `README.md` — Build and usage instructions |
| 1.8 | Docs — `docs/getting-started.md`; `docs/container/` branch (volume, pipe, state use cases); `docs/integrations/` with container (Docker) examples per language (Node, Python, Go, PHP, Ruby) |

**Storage options:** Named volume (internal) or bind mount (user-defined folder). Both supported in all container configurations.

**Project layout:**
```
├── assets/
│   ├── fonts/          (optional)
│   └── templates/      (optional)
├── docs/               # Getting started (branches by use case); container, lambda, api, ecr
├── src/
│   ├── core/           # Compile logic, state interface
│   └── adapters/
│       ├── container/
│       │   └── pulumi/
│       └── lambda-layer/
│           └── pulumi/  # Lambda Node.js + Typst Layer
├── Dockerfile
├── docker-compose.yml
├── test/               # Unit and integration tests, fixtures
└── README.md
```

---

## Phase 2: Lambda + DynamoDB (MVP)

**Goal:** Deploy Lambda (Node.js + Typst Layer) + DynamoDB. Clients invoke Lambda via AWS SDK. Internal state tracking for compile jobs.

**Architecture:**
```
Client (AWS SDK) → Lambda (Node.js + Layer) → DynamoDB (state)
                                    ↓
                                 S3 (optional)
```

**Output (AWS):**

| Mode | Description |
|------|-------------|
| Default | Return PDF in response as multipart (multipart/form-data) |
| Optional S3 | Store PDF in S3; return presigned URL for download |

**Features:**

| Feature | Description |
|---------|-------------|
| Compile .typ → PDF | Accept .typ source (or S3 key), run Typst, return PDF |
| Output: default multipart | Return compiled PDF in response as multipart (multipart/form-data) |
| Output: optional S3 | Option to store PDF in S3; return presigned URL |
| Job state tracking | DynamoDB: `document_id`, `status` (pending → compiling → completed/failed), timestamps |
| Async invocation | Submit job, get `document_id`, poll for status or result |
| Retrieve by ID | Fetch compiled PDF or status via `document_id` |
| Document status checking | Query document status (pending, compiling, completed, failed) by `document_id` without fetching PDF |
| File expiry | S3 lifecycle rules for output bucket; configurable retention for PDFs and temp objects when S3 storage is used |
| Lambda validations | Event schema validation; payload size (6MB sync, 256KB async); S3 key path validation (no traversal); document_id format on status/retrieve |
| One-click deploy | Single command (e.g. `npx pulumi up` or deploy script) deploys full AWS stack; minimal config; outputs endpoints/URLs |
| Multi-region layer | CI publishes Typst Lambda layer to multiple AWS regions (us-east-1, us-west-2, eu-west-1, etc.) on release or manual trigger |
| LocalStack verification | E2E Lambda tests run against LocalStack: sync mode (TYPST_USE_IN_MEMORY_STATE; lambda only, lambda+S3) and async mode (DynamoDB + S3; status, retrieve, workflow). `npm run test:localstack`. |

| Milestone | Tasks |
|-----------|-------|
| 2.1 | Testing — Lambda integration tests (SAM Local or LocalStack); event validation tests (schema, size, S3 keys) — write first |
| 2.2 | IaC — Pulumi in `adapters/lambda-layer/pulumi/` for Lambda (Node.js + Layer), DynamoDB, S3; S3 lifecycle rules for file expiry (configurable) |
| 2.3 | Lambda — Node.js handler: parse event; validate schema, size, S3 keys; typst compile (via Layer) → default multipart response; optional S3 storage |
| 2.4 | DynamoDB — Table: `document_id` PK, `status`, `s3_key`, timestamps |
| 2.5 | IAM — Lambda role for DynamoDB, S3, CloudWatch Logs |
| 2.6 | ECR — (Deferred) Push container image to ECR for ECS/EKS; Lambda uses Node + Layer, not container; out of Phase 2 scope |
| 2.7 | Docs — `docs/lambda/` branch (SDK invoke, multipart, S3, DynamoDB use cases); **update `docs/integrations/`** — add Lambda SDK invoke examples per language |
| 2.8 | One-click deploy — Single command to deploy Lambda + DynamoDB + S3; documented in README and `docs/getting-started.md` |
| 2.9 | LocalStack verification — E2E Lambda tests against LocalStack; full compile/status/retrieve flow with DynamoDB, S3, Lambda; runnable in CI without real AWS |
| 2.10 | Multi-region layer publish — CI (GitHub Action) publishes Typst layer to multiple AWS regions on release or manual trigger; documented in `docs/lambda/` |

---

## Phase 3: Fonts, API Gateway & S3 Delivery

**Goal:** Custom fonts and assets, HTTP API via API Gateway, S3 delivery options.

**Features:**

| Feature | Description |
|---------|-------------|
| Custom fonts | Support custom font paths in event/config |
| Asset injection | Images, logos via S3 paths or base64 |
| Asset validations | Validate asset file types; allow only Typst-supported formats (PNG, JPEG, GIF, WebP, SVG for images; supported font formats); reject unsupported types before compile |
| API Gateway | HTTP endpoints: `POST /compile`, `GET /documents/:id`; no auth by default |
| API Gateway validations | Request body size limit (10MB); request validation (JSON Schema / OpenAPI); path param validation (`:id`); Content-Type (multipart vs JSON); usage plans and throttling (429); CORS config |
| S3 delivery | Option to store PDF in S3 (customer-specified bucket/path or default); return presigned URL; default remains multipart |
| File expiry | S3 lifecycle rules; configurable retention for output bucket; per-bucket or per-prefix policies |

| Milestone | Tasks |
|-----------|-------|
| 3.1 | Testing — Param-format tests; asset validation tests; payload size, schema, path validation (reject invalid); E2E REST spec (multipart, API Gateway) — write first |
| 3.2 | Fonts/assets — Document and support custom fonts, image injection; asset type validation (Typst-supported only) |
| 3.3 | API Gateway — Pulumi (in lambda adapter): REST or HTTP API; request validation; throttling; no auth by default |
| 3.4 | S3 delivery — Customer-owned S3 destination; presigned URL return; S3 lifecycle rules for file expiry |
| 3.5 | Docs — `docs/api/` branch (REST endpoints); `docs/api/auth.md` — how to add IAM or API key auth; update `docs/getting-started.md`; **update `docs/integrations/`** — add REST API (HTTP POST) examples per language |

---

## Phase 4: Output Variants, Webhooks & Batch Jobs

**Goal:** Richer output formats, webhooks, and batch compilation.

**Features:**

| Feature | Description |
|---------|-------------|
| PDF variants | PDF/A-2b, PDF/A-3b, standard PDF (event-driven) |
| Webhooks | POST completion status and PDF URL to user-provided URL |
| Batch jobs | Compile multiple documents (e.g. from S3 listing) |

| Milestone | Tasks |
|-----------|-------|
| 4.1 | Testing — E2E test spec for webhooks and batch — write first |
| 4.2 | Output options — PDF variants, optional SVG/PNG |
| 4.3 | Webhooks — Invoke user URL on completion |
| 4.4 | Batch — Support multi-document compile flows |
| 4.5 | Docs — `docs/ecr/` (optional); complete getting-started branching; **update `docs/integrations/`** — add async/webhook and batch patterns per language as relevant |

