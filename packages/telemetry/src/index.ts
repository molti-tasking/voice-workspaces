/**
 * Logging and analytics for the server-side apps.
 *
 * Extracted from apps/worker once apps/realtime needed the same three things.
 * The one that matters is `installGenerationSink()`: `packages/llm` emits every
 * model call through a settable sink, and a service that forgets to install one
 * makes its model calls silently unobserved — no model, no latency, no cost,
 * anywhere. Sharing this package is what stops each new service having to
 * remember.
 *
 * Not imported by apps/web: `posthog-node` is a server library, and the browser
 * has its own client in apps/web/src/lib/analytics.
 */
export * from "./logger";
export * from "./analytics";
export * from "./ai-analytics";
