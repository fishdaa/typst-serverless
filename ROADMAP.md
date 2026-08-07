# Typst Serverless — Project Roadmap

## Overview

**Phase 1:** Docker packaging with internal state tracking.  
**Phase 2:** Lambda + DynamoDB (MVP features).  
**Phase 3:** Fonts, assets, API Gateway, and S3 delivery.  
**Phase 4:** Output variants, webhooks, and batch jobs.  
**Phase 5:** Optional SQS queuing, parallelized batch (1 doc per Lambda), batch status endpoint, deploy TUI.

**Phase 6:** Test coverage expansion — param/asset/font/dataJson/output variations across core and adapters (container, Lambda, API).

**Future:** Multi .typ file support (Lambda/API); Typst Universe (package cache path, docs).

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
| | 2.6 ECR — Push container image to ECR for ECS/EKS | ✅ |
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
| **Phase 5** | 5.1 SQS infrastructure (optional) — Pulumi: SQS queue, DLQ, event source mapping; config flag `enableSqs` | ✅ |
| | 5.2 API: enqueue for batch — When SQS enabled, `POST /batch` enqueues messages, returns `batchId`; batch disabled for sync or no-S3 | ✅ |
| | 5.3 Lambda: SQS trigger handler — Process single compile per message; write `batchId` to DynamoDB per document | ✅ |
| | 5.4 Batch status — `GET /batches/{batchId}` returns per-item status and S3 links for completed items | ✅ |
| | 5.5 TUI deploy — Interactive setup guides user through SQS, S3, API options | ✅ |
| | 5.6 Docs — Update docs/lambda/, docs/api/, getting-started with SQS and batch status | ✅ |
| | 5.7 dataJson — Support base64 + S3 ref `{ bucket, key }` for template data; resolve in resolve-input | ✅ |
| **Phase 6** | 6.1 Param variations — mainTyp base64, mainTypS3; outputFormat pdf/svg/png; pdfStandard | ✅ |
| | 6.2 Asset variations — fonts base64 vs S3; assets base64 vs S3; formats (OTF, TTF, PNG, JPEG, SVG) | ✅ |
| | 6.3 dataJson variations — base64 vs S3 ref; Typst-compatible JSON | ✅ |
| | 6.4 Batch variations — single, 2, 3+ docs; mixed content; verifiable outputs in test-output/ | Done |
| | 6.5 Verifiable outputs — TYPST_TEST_KEEP_OUTPUT=1 writes to test-output/<timestamp>/ for manual inspection | Done |
| | 6.6 Cross-adapter matrix — core compile, container CLI, Lambda handler, API Gateway; same inputs | ✅ |
| **Phase 7 (multi .typ)** | 7.1 resolve-input: extraTyps (base64 or S3), write to workDir; validate names/paths | ✅ |
| | 7.2 multipart: optional file part(s) extraTyp/extraTyps; API/Lambda docs for multi-file payload | ✅ |
| **Chaos** | Retry (withRetry), circuit breaker, fault injection; S3 resolve-input resilience; `test/chaos/`, `docs/chaos.md` | ✅ |
| **Tooling** | TypeScript, Vitest, build (tsc), Tests to TS, ESLint (linting), Devbox (dev shell), CI | TypeScript+Vitest ✅; Tests to TS ✅; ESLint ✅; Devbox ✅; CI ✅ |

Phase 4 complete. Phase 2.6 (ECR) complete. Phase 5 complete. Phase 6 complete (6.1–6.6, chaos). Phase 7 (multi .typ) complete. Tooling complete.

### Proof (tests & example code)

| Milestone | Proof |
|-----------|-------|
| **1.1** | Tests: `test/core/validate.spec.js`, `test/core/state.spec.js`, `test/core/compile.spec.js`, `test/integration/container.spec.js`. Fixtures: `test/fixtures/*.typ`. Run: `npm run test` (core), `npm run test:integration` (container). |
| **1.2** | `Dockerfile` — `FROM ghcr.io/typst/typst:0.14.2`. Run: `docker build -t typst-serverless .`. |
| **1.3** | `docker-compose.yml` — profiles `volume`, `volume-state`, `pipe`, `volume-pipe`. Run: `docker compose --profile volume run typst`. |
| **1.4** | Source: `src/core/compile.js`, `src/core/state.js`, `src/core/validate.js`; `src/adapters/container/cli.js`; `src/adapters/lambda-layer/handler.js`, `resolve-input.js`. |
| **1.5** | `test/integration/container.spec.js` — volume mode uses bind mount (`-v`); `docker-compose.yml` defines `typst-workspace` volume. |
| **1.6** | `src/adapters/container/` (cli.js, entrypoint.sh, pulumi/); `src/adapters/lambda-layer/` (handler.js, resolve-input.js, pulumi/). |
| **1.7** | `README.md` — Quick Start, build/run commands, env vars, Docker Compose. |
| **1.8** | `docs/getting-started.md`; `docs/container/README.md`; `docs/integrations/` (node-express.md, node-fastify.md, python-flask.md, python-fastapi.md, go.md, php.md, ruby.md). |
| **2.1** | `test/integration/lambda.spec.js` — validates payload size, event schema, S3 key path traversal, documentId. Run: `npm run test:lambda`. |
| **2.2** | `src/adapters/lambda-layer/pulumi/index.ts` — Lambda, DynamoDB table, S3 buckets, lifecycle rules. |
| **2.3** | `src/adapters/lambda-layer/handler.js` — actions: compile, status, retrieve; multipart response; S3 storage via `storeToS3`. |
| **2.4** | Pulumi `aws.dynamodb.Table` hashKey `document_id`; handler uses `createDynamoDBState` with `status`, `s3_key`, timestamps. |
| **2.5** | Pulumi: `aws.iam.Role`, `RolePolicyAttachment` (basic), `RolePolicy` (DynamoDB, S3 Get/Put). |
| **2.6** | `src/adapters/ecr/pulumi/index.ts` — ECR repository, lifecycle policy; `scripts/push-ecr.sh` — build and push image; `docs/ecr/README.md` — ECS/EKS use cases. Run: `npm run deploy:ecr` then `./scripts/push-ecr.sh`. |
| **2.7** | `docs/lambda/README.md` — deploy, invoke, S3; `docs/integrations/*.md` — Lambda SDK examples (e.g. `node-fastify.md` "Lambda (AWS SDK)" section). |
| **2.8** | `package.json`: `build:lambda`, `deploy:lambda`; `docs/lambda/README.md` "One-click deploy" section with `npm run build:lambda` + `pulumi up`. |
| **2.9** | `test/integration/localstack.spec.ts` — sync mode (TYPST_USE_IN_MEMORY_STATE; lambda only, lambda+S3) and async mode (DynamoDB + S3: status, retrieve, workflow). `scripts/localstack-setup.sh`, `scripts/test-localstack.sh`. Run: `localstack start && ./scripts/localstack-setup.sh && npm run test:localstack`. |
| **2.10** | `.github/workflows/publish-lambda-layer.yml` — publishes layer to multiple regions; `docs/lambda/README.md` "Publish Layer to Multiple Regions (CI)" section. |
| **3.1** | `test/core/assets.spec.js`, `test/integration/api.spec.js` — asset validation, REST event parsing, 10MB limit. |
| **3.2** | `src/core/assets.js` — `validateAssetKey`, `validateAssetRef`, `validateAssets`; `resolve-input.js` — fonts/assets; handler validates before compile. |
| **3.3** | `src/adapters/lambda-layer/api-handler.js`, `index.js`; Pulumi: API Gateway HTTP API, routes POST /compile, GET /documents/{id}, GET /documents/{id}/pdf. |
| **3.4** | Handler: `outputS3: { bucket, keyPrefix }`; Pulumi `customerOutputBuckets` config for IAM. |
| **3.5** | `docs/api/README.md`, `docs/api/auth.md`; `docs/getting-started.md`, `docs/lambda/README.md`, `docs/integrations/node-fastify.md` updated. |
| **4.1** | `test/integration/webhooks-batch.spec.js` — output variants, webhooks, batch validation. Run: `npm run test:integration`. |
| **4.2** | `src/core/compile.js` — `format` (pdf/svg/png), `pdfStandard` (a-2b, a-3b, etc.); handler passes through `outputFormat`, `pdfStandard`. |
| **4.3** | Handler: `webhook.url` validation; `invokeWebhook()` POSTs on completion/failure; `validateWebhookUrl` (HTTPS only). |
| **4.4** | Handler: `action: "batch"`, `validateBatchEvent`; processes `documents` array; API handler `POST /batch`. |
| **4.5** | `docs/api/README.md` — outputFormat, pdfStandard, webhook, POST /batch; `docs/lambda/README.md` Phase 4 section. |
| **5.1** | Pulumi: `aws.sqs.Queue`, DLQ, `aws.lambda.EventSourceMapping`; config `enableSqs`. |
| **5.2** | API handler: when SQS enabled, POST /batch enqueues to SQS; returns `batchId`, `documentIds`; batch disabled when sync or S3 opted out. |
| **5.3** | Lambda SQS event handler: one compile per message; DynamoDB item includes `batch_id`. |
| **5.4** | API route `GET /batches/{id}`; query DynamoDB by `batch_id` (GSI); return per-item status + S3 links. |
| **5.5** | `scripts/deploy-tui.ts` or interactive Pulumi config prompts for SQS, S3, API options. |
| **5.6** | `docs/lambda/README.md`, `docs/api/README.md`, `docs/getting-started.md` — SQS, batch status, batch disable rules. |
| **5.7** | Handler, resolve-input: `dataJson` base64 or S3 `{ bucket, key }`; write data.json to workDir for Typst. |
| **6.1** | `test/core/param-variations.spec.ts` — outputFormat pdf/svg/png; pdfStandard a-2b, a-3b, 1.4, 1.5. |
| **6.2** | Expand `test/core/assets.spec.ts` — fonts/assets base64 vs S3; OTF, TTF, PNG, JPEG, SVG. |
| **6.3** | dataJson tests — base64, S3 ref; Typst fixture using `json("data.json")`; `test/core/datajson-variations.spec.ts`. |
| **6.4** | Batch variation tests — single, 2, 3 docs; mixed content; `pdf` in batch results for test-output/. |
| **6.5** | `TYPST_TEST_KEEP_OUTPUT=1` / `npm run test:keep-output` — outputs to `test-output/<timestamp>/{core-compile,output-variants,batch}/`. |
| **6.6** | Cross-adapter fixtures; `test/fixtures/shared-payloads.ts`; `test/integration/cross-adapter.spec.ts` — same payloads, equivalent outputs (core, Lambda, API). |
| **7.1** | `src/adapters/lambda-layer/resolve-input.ts` — extraTyps (base64 or S3), `resolveExtraTyps()`; `src/core/validate.ts` — `validateExtraTyps`, `validateExtraTypName`. |
| **7.2** | `src/adapters/lambda-layer/multipart.ts` — file parts `extraTyp`/`extraTyps`; docs/api, api-gateway-options, lambda-options — extraTyps param and multipart table. |
| **Tooling (CI)** | `.github/workflows/ci.yml` — lint, build, unit/integration tests (core, lambda, api, webhooks-batch), container tests (Docker), LocalStack E2E (sync + async). Uses setup-typst, LocalStack service. |
| **Bundler** | `rollup.config.lambda.js` — bundles Lambda handler + core + AWS SDK; `npm run build:lambda` produces `dist-lambda/` with single bundle, no node_modules. |

---

## Tooling (Status & Next Steps)

**Goal:** Improve DX with TypeScript, Vitest, and a consistent dev environment, then tighten the toolchain (linting, bundling).

| Item | Description |
|------|-------------|
| **TypeScript** | `tsconfig.json` added; `src/` migrated to `.ts`; `npm run build` uses `tsc` to emit to `dist/`; `build-lambda-package.js` copies compiled output from `dist/`. |
| **Vitest** | Node `node:test` runner replaced with Vitest; `vitest.config.ts` added; `npm test`, `npm run test:core`, `npm run test:integration`, `npm run test:lambda`, `npm run test:localstack` run the suite. |
| **Tests to TS** | Done. All `test/` files are `.ts`; imports from `src/` with `.js` extension (ESM). |
| **Build/bundler** | Done. Rollup bundles Lambda handler + core + AWS SDK into a single file; `dist-lambda/` has no `node_modules`. Smaller deploy artifact. |
| **Linting** | Done. ESLint with TypeScript-aware rules, `npm run lint`; CI runs lint on push/PR. |
| **Devbox** | [Devbox](https://github.com/jetify-com/devbox) dev shell with Typst and Node.js; `devbox shell` gives a reproducible environment for `npm test` (including compile tests) without system-wide Typst. |

**Bundler (complete):** `rollup.config.lambda.js` + `build-lambda-package.js` use Rollup to produce a single `dist-lambda/adapters/lambda-layer/index.js` with handler, core, and AWS SDK. No `npm install` in `dist-lambda/`; smaller Lambda package.

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
| Lambda + API Gateway + SQS + DynamoDB + S3 | Lambda, API GW, SQS, DynamoDB, S3 | Async (Phase 5) | REST; SQS queuing; batch via SQS; batch status endpoint |

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
| `docs/options.md` | Options matrix — all permutations of sync/async, S3, SQS, batch |
| `docs/lambda-options.md` | Lambda actions reference — compile, status, retrieve, batch and all params |
| `docs/api-gateway-options.md` | API Gateway REST reference — endpoints, params, curl examples |
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
| 5 | E2E for SQS enqueue, batch status, batch disable rules; LocalStack SQS |
| 6 | Param/asset/font/dataJson/output variations across core and adapters (see Phase 6) |

**Verifiable test outputs:** Run `npm run test:keep-output` (or `TYPST_TEST_KEEP_OUTPUT=1 npm test`) to write output files to `test-output/<timestamp>/` for manual inspection. Subdirs: `core-compile/`, `output-variants/`, `batch/`. Use `TYPST_TEST_OUTPUT_RUN=<name>` to override the run dir. Files: PDF, SVG, PNG. Gitignored.

**Phase 6 — Test coverage expansion (planned):**

| Dimension | Variations to test |
|-----------|-------------------|
| **Params** | `mainTyp` (base64) vs `mainTypS3`; `outputFormat` pdf/svg/png; `pdfStandard` a-2b, a-3b, 1.4, 1.5 |
| **Fonts** | base64 vs S3 ref; OTF, TTF, TTC; single vs multiple fonts |
| **Assets** | base64 vs S3 ref; PNG, JPEG, GIF, WebP, SVG (images); multiple assets |
| **dataJson** | base64 vs S3 ref; empty vs minimal vs nested JSON |
| **Batch** | Single doc, 2 docs, 3+ docs; mixed content; include `pdf` in sequential batch results for verification |
| **Core** | `test/core/compile.spec.ts` — each output format, pdfStandard; `test/core/assets.spec.ts` — font/asset validation |
| **Container** | Volume mode with fonts/assets in workspace; pipe mode |
| **Lambda** | Handler with mainTyp, mainTypS3, fonts (base64/S3), assets (base64/S3), dataJson; LocalStack E2E |
| **API** | REST POST /compile with all param combos; multipart; validation |

**Deliverables:** `test/core/param-variations.spec.ts`, expand `test/integration/lambda.spec.ts` and `test/integration/api.spec.ts`, cross-adapter fixtures.

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

---

## Phase 5: SQS Queuing & Parallelized Batch

**Goal:** Avoid 429s under load via optional SQS queuing; parallelize batch (1 Lambda per document) when SQS is enabled; add batch status endpoint; TUI-guided deploy for SQS/S3 options.

**Architecture:**

- **Sync path (no SQS):** API Gateway → Lambda. Unchanged; batch not available.
- **Async path (SQS enabled):** API Gateway → SQS (enqueue) → Lambda (event-source mapped). 1 message per document; 1 Lambda invocation per document. DynamoDB stores state per document with `batch_id` for batch status.

**Features:**

| Feature | Description |
|---------|-------------|
| Optional SQS | Config flag `enableSqs`; when enabled, compile jobs can be enqueued instead of direct invoke |
| Batch via SQS | `POST /batch` enqueues 1 SQS message per document; returns `batchId` + `documentIds[]`; each Lambda processes 1 document |
| Batch status | `GET /batches/{batchId}` returns per-item status; completed items include S3 presigned links |
| Batch disable rules | Batch available only when SQS enabled AND S3 enabled; disabled for sync path or user opt-out of S3 |
| TUI deploy | Interactive setup guides user through SQS, S3, API options |

**Batch status response shape:**

```json
{
  "batchId": "uuid",
  "results": [
    { "documentId": "...", "status": "completed", "s3Url": "..." },
    { "documentId": "...", "status": "compiling" },
    { "documentId": "...", "status": "failed", "error": "..." }
  ]
}
```

**File references:**

- `src/adapters/lambda-layer/handler.ts` — Current `handleBatch` (sequential) bypassed when SQS path used; add SQS event handler
- `src/adapters/lambda-layer/api-handler.ts` — Add batch enqueue logic; add `GET /batches/{id}` routing
- `src/adapters/lambda-layer/pulumi/index.ts` — Add optional SQS, DLQ, event source mapping
- DynamoDB: GSI on `batch_id` to support batch status query
- New: deploy TUI script (e.g. `scripts/deploy-tui.ts` or interactive Pulumi config)

| Milestone | Tasks |
|-----------|-------|
| 5.1 | IaC — Pulumi: SQS queue, DLQ, Lambda event source mapping; config `enableSqs` |
| 5.2 | API — When SQS enabled, `POST /batch` enqueues messages; returns `batchId`; batch disabled for sync or no-S3 |
| 5.3 | Lambda — SQS trigger handler: process 1 compile per message; write `batch_id` to DynamoDB |
| 5.4 | Batch status — `GET /batches/{batchId}`; query DynamoDB by `batch_id`; return per-item status + S3 links |
| 5.5 | TUI deploy — Interactive setup guides user through SQS, S3, API options |
| 5.6 | Docs — Update `docs/lambda/`, `docs/api/`, getting-started with SQS, batch status, batch disable rules |
| 5.7 | dataJson — Base64 or S3 `{ bucket, key }` for template data; resolve in resolve-input; write data.json to workDir |

---

## Phase 6: Test Coverage Expansion

**Goal:** Broader test coverage with systematic param, asset, font, and dataJson variations across core and all adapters. Ensure the same input produces equivalent output regardless of adapter.

**Test matrix:**

| Dimension | Variations |
|-----------|------------|
| **Params** | mainTyp (base64) vs mainTypS3; outputFormat pdf/svg/png; pdfStandard a-2b, a-3b, 1.4, 1.5 |
| **Fonts** | base64 vs S3 ref; OTF, TTF, TTC; single vs multiple |
| **Assets** | base64 vs S3 ref; PNG, JPEG, GIF, WebP, SVG; single vs multiple |
| **dataJson** | base64 vs S3 ref; empty vs minimal vs nested JSON |

**Cross-adapter coverage:**

| Adapter | Tests |
|---------|-------|
| **Core** | `test/core/compile.spec.ts` — each format, pdfStandard; `test/core/assets.spec.ts` — font/asset validation |
| **Container** | Volume mode with fonts/assets; pipe mode; state mode |
| **Lambda** | Handler: mainTyp, mainTypS3, fonts (base64/S3), assets (base64/S3), dataJson; LocalStack E2E |
| **API** | REST POST /compile with param combos; multipart; validation |

| Milestone | Tasks |
|-----------|-------|
| 6.1 | Param variations — mainTyp base64, mainTypS3; outputFormat pdf/svg/png; pdfStandard |
| 6.2 | Asset variations — fonts base64 vs S3; assets base64 vs S3; formats (OTF, TTF, PNG, JPEG, SVG) |
| 6.3 | dataJson variations — base64 vs S3 ref; Typst-compatible JSON |
| 6.4 | Batch variations — single, 2, 3+ docs; mixed content; verifiable outputs (done) |
| 6.5 | Verifiable outputs — `npm run test:keep-output` writes to test-output/<timestamp>/ (done) |
| 6.6 | Cross-adapter matrix — core, container, Lambda, API; shared fixtures; same inputs → equivalent outputs |

---

## Future / Backlog

Candidate enhancements; not committed phases.

**A. Multi .typ file support (Lambda / API)**

- **Goal:** Allow documents that use `#include("other.typ")` or multiple modules when compiling via Lambda or REST API.
- **Current state:** Single `mainTyp` (or `mainTypS3`); multipart rejects a second main file; assets allow only images/fonts (no `.typ`).
- **Scope:** Lambda/API accept additional `.typ` files (e.g. `extraTyps: [{ name: "path/to/module.typ", base64 }]` or S3 refs), write them into the same workDir as main so Typst can resolve `#include` / relative imports. Validation: allow `.typ` in the "extra sources" list only; keep a single main entry point. Docs: document the new payload shape in `docs/api/README.md`, `docs/lambda/README.md`, `docs/api-gateway-options.md`.
- **Key files:** `src/adapters/lambda-layer/resolve-input.ts` (resolve and write extra .typ into workDir), `src/adapters/lambda-layer/multipart.ts` (optional multipart part for extra .typ), `src/core/validate.ts` (validate extra .typ keys/names), `src/core/assets.ts` (if reusing asset-like structure, extend allowlist for .typ only for this path).

| Milestone | Tasks |
|-----------|-------|
| 7.1 | resolve-input: accept extraTyps (base64 or S3), write to workDir; validate names/paths |
| 7.2 | multipart: optional file part(s) for extra .typ; API/Lambda docs for multi-file payload |

**B. Typst Universe support**

- **Goal:** Support documents that use [Typst Universe](https://typst.app/universe/) packages (`#import "@preview/..."`) in a documented and, where possible, reproducible way.
- **Current state:** No `--package-cache-path` or `--package-path`; no env vars; no docs. Compilation may work only with network and default cache.
- **Scope:** Container: document that Universe works when the container has network; optionally document `TYPST_PACKAGE_CACHE_PATH` / `TYPST_PACKAGE_PATH` (or CLI flags) for custom cache or pre-seeded packages in `docs/container/README.md`. Core/CLI: optional `CompileOptions` (e.g. `packageCachePath`, `packagePath`) and pass-through to `typst compile` in `src/core/compile.ts`; container CLI and Lambda handler pass env or event params through. Lambda: optional env (e.g. `TYPST_PACKAGE_CACHE_PATH=/tmp/typst-packages`) so cache lives on `/tmp`; document network requirement and cold-start impact; optionally layer or deploy step to pre-populate cache for selected packages (advanced). Docs: add a short "Typst Universe" subsection linking to typst.app/universe and describing cache/network behavior (e.g. in `docs/getting-started.md` or `docs/container/README.md` or new `docs/packages.md`).
- **Key files:** `src/core/compile.ts` (add options and `--package-cache-path` / `--package-path` when set), `src/adapters/container/cli.ts` and `src/adapters/lambda-layer/handler.ts` (pass options or env), `docs/container/README.md`, `docs/getting-started.md` or new `docs/packages.md`.

| Milestone | Tasks |
|-----------|-------|
| 8.1 | compile.ts: CompileOptions packageCachePath/packagePath; pass to typst CLI; container/Lambda pass env or params |
| 8.2 | Docs: Typst Universe subsection (cache, network, optional pre-seed); container + Lambda behavior |

**C. Cloudflare adapter**

- **Goal:** Support deploying Typst Serverless to Cloudflare Workers and Cloudflare Pages Functions, leveraging Cloudflare's serverless runtime and edge network.
- **Current state:** Adapters exist for container (Docker), Lambda (AWS), and ECR (ECS/EKS). No Cloudflare adapter.
- **Scope:** Create `src/adapters/cloudflare/` adapter with handler for Cloudflare Workers / Pages Functions runtime. Adapt core compilation logic to work within Cloudflare's V8 isolate environment and resource constraints. Use Cloudflare KV or R2 for state tracking and PDF storage (equivalent to DynamoDB + S3 in Lambda adapter). Support Cloudflare Workers Request/Response API. Handle fonts/assets via R2 or bundled binaries. Document deployment via Wrangler. Add integration tests. Update `docs/` with Cloudflare deployment guide and integration examples.
- **Key files:** New `src/adapters/cloudflare/handler.ts` (Workers request handler), `src/adapters/cloudflare/resolve-input.ts` (R2/KV input resolution), `src/adapters/cloudflare/pulumi/` or `wrangler.toml` for IaC, `test/integration/cloudflare.spec.ts`, new `docs/cloudflare/README.md`, update `docs/getting-started.md` with Cloudflare branch.
- **Challenges:** Typst binary may need to be compiled to WASM for Workers environment, or run via Cloudflare's Workers for Platforms if native binaries supported. Resource limits (CPU time, memory) may require optimization. Cold start and bundle size considerations.

| Milestone | Tasks |
|-----------|-------|
| 9.1 | Research: Typst WASM build or Workers-compatible binary; validate feasibility |
| 9.2 | Core: Cloudflare Workers handler; request/response mapping; KV/R2 state and storage integration |
| 9.3 | IaC: Wrangler config or Pulumi for Workers, KV, R2; deployment script |
| 9.4 | Testing: Integration tests for Cloudflare adapter; validate compile, status, retrieve flows |
| 9.5 | Docs: `docs/cloudflare/README.md` with setup, deploy, and usage; update `docs/getting-started.md` |

