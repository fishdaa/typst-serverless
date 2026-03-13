# Phase 1: Docker packaging for containerized Typst compilation
# Base: official Typst image
FROM ghcr.io/typst/typst:0.14.2

# Add Node.js for core logic (same code runs in Lambda)
RUN apk add --no-cache nodejs npm

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
