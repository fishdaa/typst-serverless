# Integrations

Use Typst Serverless with common languages and web frameworks to generate PDFs on demand.

| Language | Frameworks |
|----------|------------|
| **Node.js** | [Express](node-express.md) · [Fastify](node-fastify.md) · [Hono](node-hono.md) |
| **Python** | [Flask](python-flask.md) · [FastAPI](python-fastapi.md) |
| **Go** | [net/http, Chi, Echo](go.md) |
| **PHP** | [plain, Laravel, Slim](php.md) |
| **Ruby** | [Rails, Sinatra](ruby.md) |

## Output modes

| Mode | Description |
|------|-------------|
| **Container (Docker)** | Run `typst-serverless` image; volume or pipe output. See per-framework guides. |
| **Lambda (AWS SDK)** | Invoke deployed Lambda via SDK; multipart or S3. See [docs/lambda/](../lambda/README.md). |
| **REST API (HTTP)** | POST/GET to API Gateway; no AWS SDK required. See [docs/api/](../api/README.md). Shown in [Fastify](node-fastify.md) and [PHP](php.md) guides. |

## Prerequisites

**Container:**
- Docker with the `typst-serverless` image built:
  ```bash
  docker build -t typst-serverless .
  ```
- A workspace directory containing your `.typ` file(s)

**Lambda:**
- Deployed stack (see [docs/lambda/](../lambda/README.md))
- AWS SDK and credentials
