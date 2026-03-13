# Getting Started

Typst Serverless provides multiple ways to compile Typst documents to PDF. Choose your use case:

| Use Case | Description |
|----------|-------------|
| **Container (Docker)** | Run as a Docker container; volume or pipe output. [→ docs/container/](container/README.md) |
| **Lambda** | Serverless on AWS; invoke via SDK. [→ docs/lambda/](lambda/README.md) |
| **Integrations** | Node.js, Python, Go, Ruby. [→ docs/integrations/](integrations/README.md) |
| **REST API** | HTTP endpoints via API Gateway. [→ docs/api/](api/README.md) |
| **ECR / ECS / EKS** | Deploy container to AWS (optional). |

## Container (Phase 1)

1. **Build** the image:
   ```bash
   docker build -t typst-serverless .
   ```

2. **Prepare** your workspace: put `main.typ` in a folder.

3. **Run** with volume output:
   ```bash
   docker run --rm -v $(pwd):/workspace \
     -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ \
     typst-serverless
   ```
   Output: `./output.pdf`

4. Or **pipe** PDF to stdout:
   ```bash
   docker run --rm -v $(pwd):/workspace \
     -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ \
     -e TYPST_PIPE=true typst-serverless > out.pdf
   ```

See [docs/container/](container/README.md) for volume, pipe, and state tracking use cases.

## Lambda (Phase 2)

1. **Build** the Typst layer and Lambda package:
   ```bash
   npm run build:layer
   npm run build:lambda
   ```

2. **Deploy**:
   ```bash
   cd src/adapters/lambda-layer/pulumi && npm install && pulumi up
   ```

3. **Invoke** via AWS SDK (Node.js example):
   ```javascript
   const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
   const lambda = new LambdaClient({});
   const { Payload } = await lambda.send(new InvokeCommand({
     FunctionName: "typst-compile-xxx",
     Payload: JSON.stringify({ action: "compile", mainTyp: Buffer.from("#hello\n").toString("base64") }),
   }));
   ```

4. **Test locally** with LocalStack (optional):
   ```bash
   localstack start && ./scripts/localstack-setup.sh && npm run test:localstack
   ```

See [docs/lambda/](lambda/README.md) for compile, status, retrieve, S3, and LocalStack testing.
