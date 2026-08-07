# Build from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps -------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/llm/package.json ./packages/llm/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# No secrets needed here: auth and the database handle are constructed lazily on
# first request, so the build never reads credentials or opens a connection.
RUN pnpm --filter @voicemural/web build

# --- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json

# Audio lives on a mounted volume, not in the image.
RUN mkdir -p /data/storage && chown -R nextjs:nodejs /data/storage
USER nextjs

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
CMD ["pnpm", "--filter", "@voicemural/web", "start"]
