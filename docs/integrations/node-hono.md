# Node.js + Hono

Generate PDFs from a Hono app by running `typst-serverless` via `child_process`.

## Setup

```bash
npm install hono
```

## Endpoint

```javascript
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const app = new Hono();
const TYPST_IMAGE = "typst-serverless";

app.get("/pdf", async (c) => {
  const tmp = mkdtempSync(join(tmpdir(), "typst-"));
  try {
    // Write main.typ into temp dir (or use a template)
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(tmp, "main.typ"), "#hello(world)\n");

    const proc = spawn("docker", [
      "run", "--rm",
      "-v", `${tmp}:/workspace`,
      "-e", "TYPST_WORKSPACE=/workspace",
      "-e", "TYPST_MAIN=main.typ",
      "-e", "TYPST_PIPE=true",
      TYPST_IMAGE,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const chunks = [];
    proc.stdout.on("data", (ch) => chunks.push(ch));
    proc.stderr.on("data", (ch) => process.stderr.write(ch));

    const code = await new Promise((resolve) => proc.on("close", resolve));
    if (code !== 0) {
      return c.json({ error: "Compilation failed" }, 500);
    }

    const pdf = Buffer.concat(chunks);
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", "attachment; filename=\"output.pdf\"");
    return c.body(pdf);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

export default app;
```

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```javascript
import { Hono } from "hono";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const app = new Hono();
const lambda = new LambdaClient({});

app.post("/compile", async (c) => {
  const body = await c.req.json();
  
  const { Payload } = await lambda.send(new InvokeCommand({
    FunctionName: process.env.TYPST_LAMBDA_FUNCTION,
    Payload: JSON.stringify({
      action: "compile",
      mainTyp: Buffer.from(body.content || "#set page(width: 100pt)\nHello!").toString("base64"),
    }),
  }));

  const result = JSON.parse(new TextDecoder().decode(Payload));
  
  if (result.s3Url) {
    return c.json({ s3Url: result.s3Url });
  }
  
  if (result.pdf) {
    const pdfBuffer = Buffer.from(result.pdf, "base64");
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", "attachment; filename=\"output.pdf\"");
    return c.body(pdfBuffer);
  }
  
  return c.json({ error: result.error || "Unknown error" }, 500);
});

export default app;
```

## Run

```bash
# With Node.js
node --watch server.js

# With Bun
bun run server.js

# With Deno
deno run --allow-all server.js
```

## Dynamic content

Pass template data via query params or body, write a `.typ` file with `#set text(...)`, then compile. For advanced templates, use `main.typ` that `#include` other files or use typst's data-passing features.
