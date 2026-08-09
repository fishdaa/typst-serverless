# Lambda Layer Adapter (Phase 2)

Lambda deployment uses Node.js runtime + Typst Layer by default. The same
native layer can also be attached to Go functions or Rust custom-runtime
functions because it exposes `/opt/bin/typst`, independently of the function
language.

Build the layer for the function architecture:

```bash
npm run build:layer                         # x86_64 (backward-compatible zip)
LAMBDA_ARCH=arm64 npm run build:layer       # arm64 zip
```

Select the matching architecture in Pulumi with
`pulumi config set lambdaArchitecture arm64`. Node.js remains the default
runtime; Go and Rust functions should use the corresponding native Lambda
runtime/custom runtime and attach the exported `layerArn`.

See [docs/lambda/](../../../docs/lambda/README.md) for deploy and usage.
For published cross-region layer links, see the [layer links](../../../docs/lambda/README.md#layer-links-arns)
section in the deployment guide.
