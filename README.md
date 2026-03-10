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
│   ├── core/              # Compile logic, state interface, validation
│   └── adapters/
│       ├── container/     # Docker entrypoint, volume handling
│       └── lambda-layer/  # Lambda handler, Pulumi IaC
├── test/                  # Unit and integration tests
├── docs/                  # Getting started, container, lambda
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Tests

```bash
# Core unit tests (requires typst in PATH for compile tests)
npm test

# Container integration tests (requires Docker)
docker build -t typst-serverless:test .
npm run test:integration

# Lambda validation tests
npm run test:lambda
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Container Use Cases](docs/container/README.md) — volume, pipe, state
- [Integrations](docs/integrations/README.md) — Node.js (Express, Fastify), Python (Flask, FastAPI), Go, PHP, Ruby
