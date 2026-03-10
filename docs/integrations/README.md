# Integrations

Use Typst Serverless with common languages and web frameworks to generate PDFs on demand.

| Language | Frameworks |
|----------|------------|
| **Node.js** | [Express](node-express.md) · [Fastify](node-fastify.md) |
| **Python** | [Flask](python-flask.md) · [FastAPI](python-fastapi.md) |
| **Go** | [net/http, Chi, Echo](go.md) |
| **PHP** | [plain, Laravel, Slim](php.md) |
| **Ruby** | [Rails, Sinatra](ruby.md) |

## Prerequisites

- Docker with the `typst-serverless` image built:
  ```bash
  docker build -t typst-serverless .
  ```
- A workspace directory containing your `.typ` file(s)
