/**
 * A hook for observing model calls, without this package knowing what observes
 * them.
 *
 * Transcription is the one model surface that leaves no trace in the database —
 * no model, no tokens, no latency, no duration is written anywhere — so unlike
 * workspace extraction it cannot be reported from a row afterwards. It has to
 * be measured in-flight, here.
 *
 * A settable sink rather than importing an analytics client keeps `posthog-node`
 * out of a package that the web app also compiles, and means `chat()` picks up
 * the same treatment for free if it is ever called from somewhere that has not
 * arranged its own reporting.
 */

/** Caller-supplied identifiers, so an observation can be attributed. */
export interface GenerationContext {
  /** PostHog distinct_id — the owning user. */
  userId?: string;
  /** One model call, one trace. */
  traceId?: string;
  /** Groups traces: the drive a chunk belongs to. */
  sessionId?: string;
  /** Which pg-boss attempt this is, so retries are distinguishable from spend. */
  attempt?: number;
  /** Anything else worth carrying, e.g. chunk_seq. */
  extra?: Record<string, unknown>;
}

export interface GenerationObservation {
  spanName: string;
  model: string;
  latencyMs: number;
  context: GenerationContext;
  /** A stand-in for the request. Audio has no text form to log. */
  input?: { role: string; content: string }[];
  output?: string;
  httpStatus?: number;
  error?: string;
  costUsd?: number;
  properties?: Record<string, unknown>;
}

type Sink = (observation: GenerationObservation) => void;

let sink: Sink | null = null;

/** Install the observer. Called once at worker start-up. */
export function setGenerationSink(next: Sink | null): void {
  sink = next;
}

export function emitGeneration(observation: GenerationObservation): void {
  if (!sink) return;
  try {
    sink(observation);
  } catch {
    // Observation must never be able to fail a model call.
  }
}
