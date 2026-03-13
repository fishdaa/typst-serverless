#!/usr/bin/env bash
set -e
export TYPST_AWS_ENDPOINT=http://localhost:4566
export TYPST_OUTPUT_BUCKET=typst-output-test

export TYPST_USE_IN_MEMORY_STATE=1
vitest run test/integration/localstack.test.ts

unset TYPST_USE_IN_MEMORY_STATE
export TYPST_STATE_TABLE=typst-documents
vitest run test/integration/localstack.test.ts
