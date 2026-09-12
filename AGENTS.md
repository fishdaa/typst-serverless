# Agent workflow

## Use Devbox first

Run project commands inside Devbox so the pinned Node.js, Rust, Docker,
AWS CLI, and Pulumi versions are available:

```bash
devbox shell
```

For a one-off command, use `devbox run -- ...`. Devbox's init hook loads the
project AWS and Pulumi settings, builds the local Typst binary into `.bin/`,
and puts that binary on `PATH`.

The project uses the sibling checkout at `../typst` when present. The default
Typst source ref is the `fishdaa/typst` release `2026.09.0`; keep layer builds
and local builds on the same release unless the user explicitly requests a
different ref.

## AWS and Pulumi

The configured AWS profile is `typst-serverless` in `.aws/config`, using SSO
account `801651112277` in `ap-southeast-1`. If credentials expire, renew them
inside Devbox:

```bash
aws sso login --profile typst-serverless
```

The Pulumi state backend is the S3 backend configured by `devbox.json`. The
Lambda backend project is `src/adapters/lambda-layer/pulumi`, and the demo
stack is `demo`.

The live demo currently uses:

- Lambda architecture: `arm64`
- Lambda memory: `1024 MB`
- Typst PNG render cap passed by the demo: `512 MiB`
- Typst layer: `typst-binary` arm64 version 18

Do not change the demo architecture, Lambda memory, or render cap without an
explicit user request. Keep both x86_64 and arm64 layer archives available;
Pulumi manages both and attaches the configured architecture to the function.

## Common checks and deployment

From the repository root:

```bash
npm run build
npm run lint
npm run build:lambda
npm run build:layer
npm run build:layer:arm64
```

For backend deployment:

```bash
cd src/adapters/lambda-layer/pulumi
pulumi stack select demo
pulumi up
```

For the static Nuxt demo, generate against the backend `apiUrl`, deploy from
`demo/pulumi`, and invalidate CloudFront only when frontend assets changed.
Use S3-backed output for large PNG/PDF checks so API Gateway response limits do
not affect the test.

When benchmarking large PNGs, record both the Lambda billed duration and the
Typst child-process peak RSS. Use direct Lambda invocation for renders that
can exceed API Gateway's synchronous timeout, and delete temporary benchmark
functions after the test.
