# Build from the repo root:  docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/llm/package.json ./packages/llm/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 \
  && mkdir -p /data/storage && chown -R worker:nodejs /data/storage
USER worker

# The worker reads the same audio volume the web app writes to.
ENV STORAGE_DIR=/data/storage
CMD ["pnpm", "--filter", "@voicemural/worker", "start"]
