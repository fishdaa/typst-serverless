# Node.js + Express

Generate PDFs from an Express app by running `typst-serverless` via `child_process`.

## Setup

```bash
npm install express
```

## Endpoint

```javascript
import express from "express";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const app = express();
const TYPST_IMAGE = "typst-serverless";

app.get("/pdf", async (req, res) => {
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
      res.status(500).json({ error: "Compilation failed" });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"output.pdf\"");
    res.send(Buffer.concat(chunks));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

app.listen(3000);
```

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```javascript
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});
const { Payload } = await lambda.send(new InvokeCommand({
  FunctionName: process.env.TYPST_LAMBDA_FUNCTION,
  Payload: JSON.stringify({
    action: "compile",
    mainTyp: Buffer.from("#set page(width: 100pt)\nHello!").toString("base64"),
  }),
}));

const result = JSON.parse(new TextDecoder().decode(Payload));
// result.pdf = base64 PDF (inline) or result.s3Url (if storeToS3)
```

## REST API (HTTP POST)

If API Gateway is enabled ([docs/api/](../api/README.md)), skip the AWS SDK entirely and call the HTTP endpoint:

```javascript
app.post("/compile", express.json(), async (req, res) => {
  const apiUrl = process.env.TYPST_API_URL;
  const apiRes = await fetch(`${apiUrl}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documents: [{
        mainTyp: Buffer.from(req.body.content).toString("base64"),
        storeToS3: !!req.body.storeToS3,
      }],
    }),
  });
  const result = await apiRes.json();

  if (result.s3Url) {
    return res.json({ s3Url: result.s3Url });
  }
  if (result.pdf) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"output.pdf\"");
    return res.send(Buffer.from(result.pdf, "base64"));
  }
  res.status(500).json({ error: result.error || "Unknown error" });
});
```

## Dynamic content

Pass template data via query params or body, write a `.typ` file with `#set text(...)`, then compile. For advanced templates, use `main.typ` that `#include` other files or use typst’s data-passing features.
