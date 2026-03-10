# Getting Started

Serverless Typst provides multiple ways to compile Typst documents to PDF. Choose your use case:

| Use Case | Description |
|----------|-------------|
| **Container (Docker)** | Run as a Docker container; volume or pipe output. [→ docs/container/](container/README.md) |
| **Lambda** | Serverless on AWS (Phase 2). |
| **REST API** | HTTP endpoints via API Gateway (Phase 3). |
| **ECR / ECS / EKS** | Deploy container to AWS (optional). |

## Container (Phase 1)

1. **Build** the image:
   ```bash
   docker build -t serverless-typst .
   ```

2. **Prepare** your workspace: put `main.typ` in a folder.

3. **Run** with volume output:
   ```bash
   docker run --rm -v $(pwd):/workspace \
     -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ \
     serverless-typst
   ```
   Output: `./output.pdf`

4. Or **pipe** PDF to stdout:
   ```bash
   docker run --rm -v $(pwd):/workspace \
     -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ \
     -e TYPST_PIPE=true serverless-typst > out.pdf
   ```

See [docs/container/](container/README.md) for volume, pipe, and state tracking use cases.
