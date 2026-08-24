import type { ChatMessage } from "@voicemural/llm";
import { setGenerationSink } from "@voicemural/llm";
import { captureAiContent, captureRaw } from "./analytics";

/**
 * PostHog AI Observability events.
 *
 * Kept apart from `analytics.ts` because these are `$`-prefixed events PostHog
 * defines rather than ones we do, so they are outside the shared taxonomy and
 * their property names are fixed by PostHog rather than by us.
 *
 * Three naming traps, all of which produce an event that ingests happily and
 * then shows up as blank in the trace viewer:
 *
 *   - It is `$ai_output_choices`, not `$ai_output`. There is no `$ai_output`.
 *   - Both `$ai_input` and `$ai_output_choices` are *lists of message objects*,
 *     never strings.
 *   - `$ai_trace_id` is required on every AI event.
 */

export interface GenerationEvent {
  distinctId: string;
  /** Required by PostHog. One model call, one trace. */
  traceId: string;
  /**
   * Optional grouping across traces.
   *
   * The drive goes here rather than in `traceId`: a 45-minute drive is a few
   * hundred chunk transcriptions, and collapsing them into one trace produces a
   * pseudo-trace whose reported latency is the sum of hundreds of independent
   * calls spread over hours, which is a meaningless number.
   */
  sessionId?: string;
  spanName: string;
  model: string;
  latencyMs: number;
  input?: ChatMessage[];
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  httpStatus?: number;
  error?: string | null;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

/**
 * The provider, for PostHog's cost lookup and grouping.
 *
 * Derived from the model name's prefix rather than hardcoded to "litellm".
 * LiteLLM is a proxy, not a provider: everything here routes through it, so
 * labelling every call with it would collapse the one dimension that separates
 * a paid Anthropic call from a free self-hosted one.
 */
function providerFor(model: string): string {
  const [prefix] = model.split("/");
  return prefix && prefix !== model ? prefix : "litellm";
}

export function captureGeneration(event: GenerationEvent): void {
  const includeContent = captureAiContent();

  captureRaw(
    event.distinctId,
    "$ai_generation",
    {
      $ai_trace_id: event.traceId,
      ...(event.sessionId ? { $ai_session_id: event.sessionId } : {}),
      $ai_span_name: event.spanName,
      $ai_model: event.model,
      $ai_provider: providerFor(event.model),
      $ai_base_url: process.env.LITELLM_BASE_URL,
      // PostHog expects seconds, not milliseconds.
      $ai_latency: event.latencyMs / 1000,
      $ai_is_error: Boolean(event.error),
      ...(event.error ? { $ai_error: event.error } : {}),
      ...(event.httpStatus ? { $ai_http_status: event.httpStatus } : {}),

      // Left absent, never zero. Whisper returns no token counts at all, and a
      // zero would be averaged in as a real measurement, dragging every
      // tokens-per-call figure towards nothing.
      ...(event.inputTokens !== undefined ? { $ai_input_tokens: event.inputTokens } : {}),
      ...(event.outputTokens !== undefined ? { $ai_output_tokens: event.outputTokens } : {}),
      ...(event.costUsd !== undefined ? { $ai_total_cost_usd: event.costUsd } : {}),

      ...(includeContent && event.input ? { $ai_input: event.input } : {}),
      ...(includeContent && event.output !== undefined
        ? { $ai_output_choices: [{ role: "assistant", content: event.output }] }
        : {}),

      ...event.properties,
    },
    event.timestamp,
  );
}

/**
 * Route observations from `packages/llm` into AI Observability.
 *
 * Only transcription needs this. Workspace extraction reports itself from its
 * own call site, where it already holds the extraction id, the ops it produced
 * and whether the cache answered — none of which `packages/llm` can see.
 */
export function installGenerationSink(): void {
  setGenerationSink((observation) => {
    const { context } = observation;
    // Without an owner there is nobody to attribute the call to. Falling back
    // to the drive keeps the event, and `$process_person_profile` is left alone
    // because a capture-session id is a real join key here, not a junk person.
    const distinctId = context.userId ?? context.sessionId;
    if (!distinctId) return;

    captureGeneration({
      distinctId,
      traceId: context.traceId ?? distinctId,
      sessionId: context.sessionId,
      spanName: observation.spanName,
      model: observation.model,
      latencyMs: observation.latencyMs,
      input: observation.input as ChatMessage[] | undefined,
      output: observation.output,
      // Deliberately no token counts: Whisper reports none, and a zero would be
      // averaged in as though it were measured.
      costUsd: observation.costUsd,
      httpStatus: observation.httpStatus,
      error: observation.error ?? null,
      properties: { ...observation.properties, retry_attempt: context.attempt },
    });
  });
}
