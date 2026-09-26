# syntax=docker/dockerfile:1.7
# One image, two entrypoints: API (default) and worker (`node dist/worker.js`). Build context = repo root.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @fitness-league/api...
COPY apps/api apps/api
COPY infra/seed-data infra/seed-data
RUN pnpm --filter @fitness-league/api exec prisma generate \
 && pnpm --filter @fitness-league/api build \
 && pnpm deploy --filter @fitness-league/api --prod --legacy /out \
 && cp -r apps/api/dist apps/api/prisma /out/ \
 && cp -r infra/seed-data /out/seed-data \
 && cd /out && npx prisma generate

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SEED_DATA_DIR=/app/seed-data
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
