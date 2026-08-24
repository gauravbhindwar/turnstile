# syntax=docker/dockerfile:1.7
# Node 22 throughout: pnpm 11's CLI needs node:sqlite (Node >=22.13) to
# install, and the gateway itself uses node:sqlite for storage (ADR-003) —
# both build and runtime stages need it, unlike the D1 "Node >= 20" floor.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN npx --yes turbo prune @turnstile/gateway @turnstile/cli --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# turbo prune only copies files reachable from package.json/lockfile graphs,
# not root-level shared configs like tsconfig.base.json — copy it explicitly.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@turnstile/gateway --filter=@turnstile/cli
RUN pnpm deploy --filter=@turnstile/gateway --prod --legacy /app/deploy/gateway

FROM gcr.io/distroless/nodejs22-debian12 AS runner
WORKDIR /app
COPY --from=builder /app/deploy/gateway /app
ENV NODE_ENV=production
EXPOSE 8787 8888
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node", "dist/index.js"]
