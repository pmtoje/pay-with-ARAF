# Pay with ARAF — Next.js web apps. Build with: --build-arg APP=admin-portal (customer-checkout | partner-portal | admin-portal | developer-portal | altmall-demo)
FROM node:22-bookworm-slim AS build
ARG APP
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "@araf/${APP}" build

FROM node:22-bookworm-slim AS runtime
ARG APP
ENV NODE_ENV=production APP=${APP}
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* && groupadd -r web && useradd -r -g web -d /app web
WORKDIR /app
COPY --from=build --chown=web:web /repo /app
USER web
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd apps/${APP} && npx next start -p ${PORT:-3000}"]
