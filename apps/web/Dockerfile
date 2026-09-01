# Build from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
# `prepare` bakes pnpm into the image. With only `corepack enable`, every
# container start fetches pnpm from npmjs.org, so booting the app depends on the
# registry being reachable.
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

# --- deps -------------------------------------------------------------------
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

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
# Fail loudly if a workspace package was left out of the COPY list above.
#
# pnpm only installs for packages whose manifest is present at install time, so
# a missing line yields a package with no node_modules — and the first symptom
# is an unresolvable dependency deep inside that package's source, which reads
# as a code error rather than a Dockerfile omission. This turns it back into
# the one-line fix it actually is.
RUN for pkg in packages/*/; do \
      if [ -f "$pkg/package.json" ] && [ ! -d "$pkg/node_modules" ]; then \
        echo "ERROR: $pkg has no node_modules — add 'COPY $pkg""package.json ./$pkg' to the deps stage of this Dockerfile." >&2; \
        exit 1; \
      fi; \
    done
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_ vars are inlined into the client bundle at build time, so they
# must arrive as build args rather than container-runtime environment.
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_TALKBACK_ENABLED
ENV NEXT_PUBLIC_TALKBACK_ENABLED=$NEXT_PUBLIC_TALKBACK_ENABLED
# Which talk-back backend the bundle talks to. Baked in like the flag above,
ARG NEXT_PUBLIC_PIPECAT_URL
ENV NEXT_PUBLIC_PIPECAT_URL=$NEXT_PUBLIC_PIPECAT_URL
ARG NEXT_PUBLIC_ICE_SERVERS
ENV NEXT_PUBLIC_ICE_SERVERS=$NEXT_PUBLIC_ICE_SERVERS
# Not for auth — the runtime container has its own copy for that. Prerendered
# pages resolve their canonical, og:url and og:image against the origin present
# at BUILD time, so without this the participant information sheet unfurls with
# a link preview pointing at http://localhost:3000. Absent here (a plain
# `docker build`) it falls back to localhost, which is right for a local build.
ARG BETTER_AUTH_URL
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
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
