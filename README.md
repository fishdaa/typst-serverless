# Typst Serverless

Containerized and serverless Typst compilation. One core, multiple deployment outputs.

## Quick Start

### Build

```bash
docker build -t typst-serverless .
```

### Run (volume mode)

Place `main.typ` in a directory, mount it as `/workspace`, and run:

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_OUTPUT=output.pdf \
  typst-serverless
```

Output PDF will be written to `./output.pdf`.

### Run (pipe mode — stream PDF to stdout)

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_PIPE=true \
  typst-serverless > output.pdf
```

### Run (with state tracking)

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_OUTPUT=output.pdf \
  -e TYPST_STATE=true \
  typst-serverless
```

State is stored in `/workspace/.typst-state/state.json`.

## Docker Compose

```bash
# Build
docker compose build

# Run with volume profile (default)
docker compose --profile volume run typst
```

Place `main.typ` in the `typst-workspace` volume or use a bind mount:

```yaml
volumes:
  - ./my-docs:/workspace
```

## Environment Variables

| Variable       | Default     | Description                              |
|----------------|-------------|------------------------------------------|
| TYPST_WORKSPACE| /workspace  | Workspace directory                      |
| TYPST_MAIN     | main.typ    | Main .typ file (relative to workspace)   |
| TYPST_OUTPUT   | output.pdf  | Output PDF (relative to workspace)       |
| TYPST_PIPE     | false       | If `true`, stream PDF to stdout          |
| TYPST_STATE    | false       | If `true`, track job state in volume     |

## Lambda (Phase 2)

One-click deploy to AWS (Lambda + DynamoDB + S3):

```bash
npm install
npm run build:layer   # Downloads Typst binary for Lambda
npm run build:lambda  # Packages handler + deps
cd src/adapters/lambda-layer/pulumi && npm install && pulumi up
```

Invoke via AWS SDK — see [docs/lambda/](docs/lambda/README.md) for compile, status, retrieve, and S3 options.

## Project Structure

```
├── src/
│   ├── core/              # Compile logic, state interface, validation, chaos
│   └── adapters/
│       ├── container/     # Docker entrypoint, volume handling
│       └── lambda-layer/  # Lambda handler, Pulumi IaC
├── test/                  # Unit and integration tests
├── docs/                  # Getting started, container, lambda
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Development & Tests

Use the `@/` path alias for imports from `src/` (e.g. `import { compile } from "@/core/compile.js"`). Configured in `tsconfig.json`, resolved by Vitest for tests and rewritten to relative paths for the build via `tsc-alias`.

- **Install dependencies**:

```bash
npm install
```

- **Build TypeScript** (emits to `dist/`):

```bash
npm run build
```

- **Run tests** (Vitest):

```bash
# Full test suite: build + core + integration + LocalStack (requires Docker, LocalStack)
npm test

# Core/unit tests only
npm run test:core

# Integration tests (container, Lambda, API, webhooks, batch)
npm run test:integration

# Keep test outputs for manual inspection (PDF, SVG, PNG → test-output/<timestamp>/)
npm run test:keep-output          # Full suite
npm run test:keep-output:core     # Core + webhooks-batch only (faster; needs Typst in PATH)

# Lambda-only tests
npm run test:lambda

# LocalStack E2E (sync + async)
localstack start && ./scripts/localstack-setup.sh && npm run test:localstack
```

If you use [Devbox](https://github.com/jetify-com/devbox), `devbox shell` provides a dev environment with Typst and Node.js so compile tests can run without additional system setup.

## Contributing

1. **Set up** — run `./setup.sh` to install dependencies, build, and run core tests.
2. **Run tests** before submitting: `npm test` (full suite; requires Docker + LocalStack) or `npm run test:core` (core only; requires Typst in PATH, e.g. `devbox shell`).
3. Keep changes typed (TypeScript in `src/`), add or update tests as needed.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Chaos Engineering](docs/chaos.md) — Retry, circuit breaker, fault injection
- [Container Use Cases](docs/container/README.md) — volume, pipe, state
- [Integrations](docs/integrations/README.md) — Node.js (Express, Fastify), Python (Flask, FastAPI), Go, PHP, Ruby
- [Documentation Wiki](https://github.com/fishdaa/typst-serverless/wiki) — browsable documentation mirror
