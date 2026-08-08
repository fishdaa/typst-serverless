# Phase 1: Docker packaging for containerized Typst compilation
# Typst binary: built from source from the fishdaa/typst fork (branch
# optimize-large-png), which carries perf patches for large raster/poster PNG
# export (fast image resampling, SVG dedup, PDF tiling pattern caching).
FROM rust:1-alpine AS typst-builder
RUN apk add --no-cache git musl-dev
ARG TYPST_REPO=https://github.com/fishdaa/typst.git
ARG TYPST_REF=optimize-large-png
RUN git clone --depth 1 --branch ${TYPST_REF} ${TYPST_REPO} /typst-src
WORKDIR /typst-src
RUN cargo build --release --locked -p typst-cli

FROM node:24-alpine

COPY --from=typst-builder /typst-src/target/release/typst /usr/local/bin/typst

WORKDIR /app

# Optional: fonts and templates (directories may be empty)
COPY assets/fonts/ /app/fonts/
COPY assets/templates/ /app/templates/

# Build: copy deps (include dev for tsc), build TypeScript
COPY package.json package-lock.json* /app/
COPY tsconfig.json /app/
COPY src/ /app/src/
RUN npm ci 2>/dev/null || npm install
RUN npm run build

COPY src/adapters/container/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chmod -R a+rX /app

ENV NODE_PATH=/app
WORKDIR /workspace

ENTRYPOINT ["/app/entrypoint.sh"]
