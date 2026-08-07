#!/usr/bin/env bash
set -e
export TYPST_OUTPUT_BUCKET=typst-output-test
export TYPST_ASSETS_BUCKET=typst-input-test
export TYPST_PATH="${TYPST_PATH:-typst}"

# Only set TYPST_AWS_ENDPOINT when LocalStack is reachable (S3 tests will skip otherwise)
if curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1; then
    export TYPST_AWS_ENDPOINT=http://localhost:4566
else
    echo "LocalStack not reachable at localhost:4566 - S3-dependent tests will be skipped"
fi

export TYPST_USE_IN_MEMORY_STATE=1
npx vitest run test/integration/localstack.spec.ts

unset TYPST_USE_IN_MEMORY_STATE
export TYPST_STATE_TABLE=typst-documents
npx vitest run test/integration/localstack.spec.ts
