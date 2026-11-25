# Pay with ARAF — API and worker image (same image, different command).
# Build: docker build -f infrastructure/docker/api.Dockerfile -t araf-api .
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter "./packages/*" build \
 && pnpm --filter @araf/api build \
 && pnpm prune --prod --config.ignore-scripts=true || true

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r araf && useradd -r -g araf -d /app araf
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=araf:araf /repo /app
USER araf
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Worker: override with ["node", "apps/api/dist/worker.js"]
CMD ["node", "apps/api/dist/main.js"]
