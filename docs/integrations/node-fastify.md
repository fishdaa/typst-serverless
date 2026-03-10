# Node.js + Fastify

Generate PDFs from Fastify by running `typst-serverless` via `child_process`.

## Setup

```bash
npm install fastify
```

## Route

```javascript
import Fastify from "fastify";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fastify = Fastify();
const TYPST_IMAGE = "typst-serverless";

fastify.get("/pdf", async (request, reply) => {
  const tmp = mkdtempSync(join(tmpdir(), "typst-"));
  try {
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
      return reply.status(500).send({ error: "Compilation failed" });
    }

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", "attachment; filename=\"output.pdf\"")
      .send(Buffer.concat(chunks));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await fastify.listen({ port: 3000 });
```
