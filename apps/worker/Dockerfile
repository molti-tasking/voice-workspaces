# Build from the repo root:  docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS base
# `prepare` bakes pnpm into the image. With only `corepack enable`, every
# container start fetches pnpm from npmjs.org, so booting the app depends on the
# registry being reachable.
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/llm/package.json ./packages/llm/
COPY packages/shared/package.json ./packages/shared/
COPY packages/talkback/package.json ./packages/talkback/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/workspace/package.json ./packages/workspace/
RUN pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# pnpm resolves each workspace package's dependencies from that package's own
# node_modules, so without these the image has no drizzle-orm for packages/db
# and no drizzle-kit to migrate with. Copied after the source, since `COPY
# packages` from a clean checkout brings no node_modules of its own.
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/llm/node_modules ./packages/llm/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/talkback/node_modules ./packages/talkback/node_modules
COPY --from=deps /app/packages/telemetry/node_modules ./packages/telemetry/node_modules
COPY --from=deps /app/packages/workspace/node_modules ./packages/workspace/node_modules

# Fail loudly if a workspace package was left out of either COPY list above.
#
# pnpm only installs for packages whose manifest is present at install time, so
# a missing line yields a package with no node_modules — and the first symptom
# is an unresolvable dependency deep inside that package's source, which reads
# as a code error rather than a Dockerfile omission. This turns it back into
# the two-line fix it actually is.
#
# TWO lists, unlike apps/web/Dockerfile, and a new package needs a line in BOTH.
# `COPY packages ./packages` above brings source with no node_modules of its own,
# so the deps stage's manifest is only half the job — the per-package restore is
# what actually puts node_modules in this image. Naming only the deps stage here
# is what cost a deploy cycle when `talkback` was added: the manifest was already
# there, and the message sent the reader to the list that was already correct.
RUN for pkg in packages/*/; do \
      if [ -f "$pkg/package.json" ] && [ ! -d "$pkg/node_modules" ]; then \
        echo "ERROR: $pkg has no node_modules. TWO lines are needed in this Dockerfile:" >&2; \
        echo "  1. deps stage:   COPY $pkg""package.json ./$pkg" >&2; \
        echo "  2. runner stage: COPY --from=deps /app/$pkg""node_modules ./$pkg""node_modules" >&2; \
        exit 1; \
      fi; \
    done

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 \
  && mkdir -p /data/storage && chown -R worker:nodejs /data/storage
USER worker

# The worker reads the same audio volume the web app writes to.
ENV STORAGE_DIR=/data/storage
CMD ["pnpm", "--filter", "@voicemural/worker", "start"]
