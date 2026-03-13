#!/usr/bin/env bash
docker run --rm --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$(pwd):/project" -w /project typst-serverless:test \
  -c "npm ci && npm run build && npx vitest run test/core/"
