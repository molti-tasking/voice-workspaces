/**
 * Putting an eval run into Langfuse, next to the drives.
 *
 * The container's live turns reach Langfuse as OpenTelemetry spans — see
 * `setup_langfuse_tracing` in `bot.py` — with `session.id` set to the capture
 * session and `langfuse.trace.tags` naming the prompt version. The harness does
 * not run inside Pipecat, so it has no pipeline to instrument; it builds the
 * same shape itself, with the Langfuse SDK: one trace per evaluated turn, a
 * generation for the reply and one for the judge, and the check result and
 * judge scores as scores on the turn's root observation. Same keys as bot.py,
 * same project, so a filter on `version` shows drives and eval runs together.
 *
 * This used to be one POST per turn against `/api/public/ingestion` with a
 * hand-built `trace-create` / `generation-create` / `score-create` batch. That
 * endpoint is the v3 ingestion path and its trace-level `input`/`output` are
 * deprecated: a v4 project reads the overall input and output off the ROOT
 * OBSERVATION, and reads the session, tags and version off span attributes
 * propagated to every child. So the batch is gone and `@langfuse/tracing`
 * builds real spans instead — which is also what finally puts the session id on
 * the cost-bearing generations rather than on the trace alone, so session cost
 * adds up.
 *
 * Still entirely optional: without the keys nothing is exported and the run
 * says so once.
 */

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  getActiveTraceId,
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface LangfuseConfig {
  /** Base URL of the Langfuse instance. No trailing slash. */
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  /**
   * Langfuse's first-class environment separation, new in v4. Left undefined
   * unless it is set, so an eval run lands in the same environment as the
   * drives it is meant to be compared against rather than quietly beside them.
   */
  environment: string | undefined;
}

/**
 * The keys and the host, or null when Langfuse is not configured.
 *
 * `LANGFUSE_BASE_URL` is what the v4+ SDKs read. `LANGFUSE_HOST` is the v3
 * spelling; the Python SDK still accepts it and this repo still sets it, so it
 * stays as a fallback rather than a breaking rename.
 */
export function langfuseConfig(env: NodeJS.ProcessEnv = process.env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  const baseUrl = env.LANGFUSE_BASE_URL || env.LANGFUSE_HOST || "https://cloud.langfuse.com";
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    publicKey,
    secretKey,
    environment: env.LANGFUSE_TRACING_ENVIRONMENT || undefined,
  };
}

export interface GenerationRecord {
  name: string;
  model: string;
  input: unknown;
  output: string;
  startedAt: Date;
  latencyMs: number;
  usage?: { input: number; output: number };
}

export interface ScoreRecord {
  name: string;
  value: number | string;
  comment?: string;
}

/** One evaluated turn, as the harness has it once the turn is over. */
export interface TraceRecord {
  name: string;
  sessionId: string;
  tags: string[];
  version: string;
  input: unknown;
  output: string;
  metadata: Record<string, unknown>;
  generations: GenerationRecord[];
  scores: ScoreRecord[];
  /** When the turn began, so the root observation spans the real work. */
  startedAt: Date;
}

/** A configured exporter and the client the scores go through. */
export interface Langfuse {
  config: LangfuseConfig;
  processor: LangfuseSpanProcessor;
  provider: NodeTracerProvider;
  client: LangfuseClient;
}

/**
 * Wire up the exporter. Call once per run, before the first turn.
 *
 * `register()` rather than a private provider: `propagateAttributes` puts the
 * session, tags and version into the OpenTelemetry CONTEXT, and context does
 * not propagate at all without a real context manager installed globally —
 * the API's default is a no-op that drops it. Registering is what installs one.
 * `setLangfuseTracerProvider` then keeps Langfuse's own spans on this provider
 * explicitly rather than relying on the global lookup.
 */
export function startLangfuse(
  config: LangfuseConfig,
  options: { exporter?: SpanExporter } = {},
): Langfuse {
  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    ...(options.exporter ? { exporter: options.exporter } : {}),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  setLangfuseTracerProvider(provider);
  return {
    config,
    processor,
    provider,
    client: new LangfuseClient({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
    }),
  };
}

/**
 * Emit one evaluated turn and return the trace id it landed under.
 *
 * The propagation scope is opened BEFORE any observation is created, which is
 * the whole point of it: `sessionId`, `tags`, `version` and `environment` are
 * then on the root observation AND on both generations, so a session's cost
 * includes the model calls that incurred it and a filter on `version` catches
 * every child rather than the root alone.
 *
 * Both generations are reconstructed with the timings the turn actually had —
 * `startTime` on creation, the measured end passed to `end()` — rather than
 * with the clock at export time, so latency in Langfuse matches the latency the
 * report prints.
 */
export function traceTurn(langfuse: Langfuse, trace: TraceRecord): string {
  return propagateAttributes(
    {
      traceName: trace.name,
      sessionId: trace.sessionId,
      tags: trace.tags,
      version: trace.version,
      ...(langfuse.config.environment ? { environment: langfuse.config.environment } : {}),
    },
    () =>
      startActiveObservation(
        trace.name,
        (root) => {
          // Overall input/output belongs on the ROOT OBSERVATION. The trace's
          // own input/output fields are the deprecated v3 shape and are
          // deliberately not written — `setTraceIO` stays unused.
          root.update({
            input: trace.input,
            output: trace.output,
            metadata: trace.metadata,
          });

          for (const generation of trace.generations) {
            const child = startObservation(
              generation.name,
              {
                model: generation.model,
                input: generation.input,
                output: generation.output,
                ...(generation.usage
                  ? { usageDetails: { input: generation.usage.input, output: generation.usage.output } }
                  : {}),
              },
              { asType: "generation", startTime: generation.startedAt },
            );
            child.end(new Date(generation.startedAt.getTime() + generation.latencyMs));
          }

          // Scored against the root observation, not the trace: the score then
          // carries an observation id as well as a trace id, which is what an
          // observation-level evaluator in a v4 project compares itself with.
          for (const score of trace.scores) {
            langfuse.client.score.observation(
              { otelSpan: root.otelSpan },
              {
                name: score.name,
                value: score.value,
                ...(score.comment ? { comment: score.comment } : {}),
                dataType: typeof score.value === "number" ? "NUMERIC" : "CATEGORICAL",
              },
            );
          }

          return getActiveTraceId() ?? "";
        },
        { startTime: trace.startedAt },
      ),
  );
}

/**
 * Get everything out before the process exits.
 *
 * Spans are batched and scores are queued, so without this a short run exits
 * with most of itself still in memory — the one delivery difference from the
 * POST-per-turn this replaced, and the reason it is awaited rather than left
 * to an exit handler.
 */
export async function flushLangfuse(langfuse: Langfuse): Promise<void> {
  await langfuse.client.score.flush();
  await langfuse.processor.forceFlush();
  await langfuse.provider.shutdown();
}
