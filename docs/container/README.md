# Container Use Cases

Use the Docker image for local or CI Typst compilation. Supports volume output, pipe output, and optional state tracking.

## Storage Options

- **Named volume** — `docker compose` default
- **Bind mount** — Map a host folder: `-v $(pwd):/workspace`

## Configuration Modes

| Mode | Output | State |
|------|--------|-------|
| Volume | Write PDF to workspace | No |
| Volume + state | Write PDF + job state to workspace | Yes |
| Pipe | Stream PDF to stdout | No |
| Volume + pipe | Write to workspace AND stream to stdout | Optional |

## Volume Mode

Write compiled PDF to the workspace directory.

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_OUTPUT=output.pdf \
  typst-serverless
```

## Pipe Mode

Stream PDF to stdout. Use for pipelines or capturing output without writing to a file.

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_PIPE=true \
  typst-serverless > output.pdf
```

## State Mode

Enable job state tracking. State is stored in `./.typst-state/state.json` inside the workspace.

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_OUTPUT=output.pdf \
  -e TYPST_STATE=true \
  typst-serverless
```

State format:
```json
{
  "<document_id>": {
    "status": "completed",
    "outputPath": "/workspace/output.pdf",
    "createdAt": 1234567890
  }
}
```

## Volume + Pipe Mode

Write PDF to the workspace and also stream it to stdout.

```bash
docker run --rm -v $(pwd):/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=main.typ \
  -e TYPST_OUTPUT=output.pdf \
  -e TYPST_PIPE=true \
  typst-serverless > copy.pdf
# output.pdf in workspace AND copy.pdf from stdout
```

## Custom Paths

- `TYPST_MAIN`: Path to main .typ file relative to workspace (default: `main.typ`)
- `TYPST_OUTPUT`: Output PDF path relative to workspace (default: `output.pdf`)

Example with nested structure:

```bash
docker run --rm -v $(pwd)/docs:/workspace \
  -e TYPST_WORKSPACE=/workspace \
  -e TYPST_MAIN=src/report.typ \
  -e TYPST_OUTPUT=dist/report.pdf \
  typst-serverless
```
