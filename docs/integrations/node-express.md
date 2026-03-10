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

## Dynamic content

Pass template data via query params or body, write a `.typ` file with `#set text(...)`, then compile. For complex templates, use `main.typ` that `#include` other files or use typst’s data-passing features.
