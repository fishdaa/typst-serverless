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

## Project Structure

```
├── src/
│   ├── core/              # Compile logic, state interface
│   └── adapters/
│       ├── container/     # Docker entrypoint, volume handling
│       └── lambda-layer/  # Lambda (Phase 2)
├── test/                  # Unit and integration tests
├── docs/                  # Getting started, container, lambda
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Tests

```bash
# Build the image first
docker build -t typst-serverless .

# Unit tests (run inside Docker; typst from image)
npm test

# Container integration tests
npm run test:integration
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Container Use Cases](docs/container/README.md) — volume, pipe, state
- [Integrations](docs/integrations/README.md) — Node.js (Express, Fastify), Python (Flask, FastAPI), Go, PHP, Ruby
