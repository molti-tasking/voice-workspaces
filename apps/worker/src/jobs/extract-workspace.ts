import {
  advanceCursor,
  appendOps,
  findCachedExtraction,
  loadOps,
  loadPendingSegments,
  recordExtraction,
  sessionIdsForUtterances,
} from "@voicemural/db/workspace";
import { chat, modelFor, type ChatMessage, type ChatResult } from "@voicemural/llm";
import {
  EXTRACTION_SEED,
  EXTRACTION_TEMPERATURE,
  PROMPT_VERSION,
  buildExtractionPrompt,
  computeInputHash,
  foldWorkspace,
  parseExtractionResponse,
  stateDigest,
  type TranscriptSegment,
} from "@voicemural/workspace";
import { capture, captureGeneration, log } from "@voicemural/telemetry";

/**
 * Utterances per extraction. Both the trigger threshold and the take size.
 *
 * Per-chunk extraction would see 10-second fragments and produce half-formed
 * claims; a thought usually needs longer than that to finish.
 *
 * Crucially this is a FIXED size, not "however much is pending". Batch
 * boundaries have to be a pure function of the transcript, or live extraction
 * and `workspace:rebuild` slice the same speech differently — different slices
 * mean different cache keys, so a rebuild would miss the cache, pay for fresh
 * calls, and produce a different workspace. The determinism guarantee lives or
 * dies on this being deterministic.
 *
 * A trailing partial batch is only taken once the session has ended, which the
 * sweep enforces; a live session simply waits for the next utterances.
 */
export const BATCH_SIZE = Number(process.env.WORKSPACE_BATCH_SIZE ?? 8);

export interface ExtractionOutcome {
  segments: number;
  opsAppended: number;
  cacheHit: boolean;
  totalTokens: number;
  skipped?: string;
}

/**
 * Bring a user's workspace up to date with their transcript.
 *
 * The interesting property is that this is *cached*: the model is called only
 * when this exact input has never been seen before. Replaying a transcript, or
 * rebuilding after a parser fix, makes no network calls at all — which is what
 * makes the workspace deterministic rather than merely re-derivable.
 */
export async function extractWorkspace(userId: string): Promise<ExtractionOutcome> {
  const pending = await loadPendingSegments(userId, BATCH_SIZE);

  if (pending.length === 0) {
    return { segments: 0, opsAppended: 0, cacheHit: false, totalTokens: 0, skipped: "nothing pending" };
  }

  const state = foldWorkspace(await loadOps(userId));
  const digest = stateDigest(state);
  const requestedModel = modelFor("reasoning");

  const inputHash = computeInputHash({
    promptVersion: PROMPT_VERSION,
    model: requestedModel,
    temperature: EXTRACTION_TEMPERATURE,
    segments: pending,
    stateDigest: digest,
  });

  const messages = buildExtractionPrompt(state, pending);

  // --- the cache -----------------------------------------------------------
  const cached = await findCachedExtraction(userId, inputHash);
  let extractionId: string;
  let rawResponse: string;
  let cacheHit = false;
  let totalTokens = 0;

  /** Set only on a live call, so analytics can tell spend from a replay. */
  let liveCall: ChatResult | undefined;

  if (cached) {
    extractionId = cached.id;
    rawResponse = cached.rawResponse;
    cacheHit = true;
  } else {
    const result = await chat(messages, {
      role: "reasoning",
      temperature: EXTRACTION_TEMPERATURE,
      seed: EXTRACTION_SEED,
      json: true,
    });

    rawResponse = result.content;
    totalTokens = result.usage.totalTokens;
    liveCall = result;

    // Parse first so warnings land on the row, but persist regardless of the
    // outcome: an unparseable response must still be replayable later.
    const preview = parseExtractionResponse(rawResponse, { idSeed: inputHash });

    extractionId = await recordExtraction({
      userId,
      inputHash,
      promptVersion: PROMPT_VERSION,
      requestedModel: result.requestedModel,
      resolvedModel: result.resolvedModel,
      temperature: EXTRACTION_TEMPERATURE,
      seed: EXTRACTION_SEED,
      inputSegmentIds: pending.map((s) => s.id),
      stateDigest: digest,
      requestMessages: messages,
      rawResponse,
      parseError: preview.error,
      parseWarnings: preview.warnings,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      latencyMs: result.latencyMs,
    });
  }

  const parsed = parseExtractionResponse(rawResponse, { idSeed: inputHash });

  const last = pending[pending.length - 1]!;
  const sourceIds = pending.map((s) => s.id);
  const sessionByUtterance = await sessionIdsForUtterances([last.id]);


  const opsAppended = await appendOps({
    userId,
    extractionId,
    ops: parsed.ops,
    occurredAt: last.occurredAt,
    // Places each op at the time of the earliest utterance it cites, so a
    // topic reads in the order things were actually said.
    segmentTimes: new Map(pending.map((s) => [s.id, s.occurredAt])),
    captureSessionId: sessionByUtterance.get(last.id),
    sourceUtteranceIds: sourceIds,
  });

  // Always advance, even when the model produced nothing. A stretch of filler
  // legitimately yields no ops, and not advancing would re-extract it forever.
  await advanceCursor(userId, last.id, last.occurredAt);

  reportExtraction({
    userId,
    extractionId,
    captureSessionId: sessionByUtterance.get(last.id),
    segments: pending.length,
    opsAppended,
    messages,
    rawResponse,
    parseError: parsed.error ?? null,
    parseWarningCount: parsed.warnings.length,
    liveCall,
  });

  if (parsed.error) {
    log.warn("extraction did not parse", { userId, extractionId, error: parsed.error });
  }
  if (parsed.warnings.length > 0) {
    log.warn("extraction had unusable ops", {
      userId,
      extractionId,
      dropped: parsed.warnings.length,
      first: parsed.warnings[0],
    });
  }

  log.info("workspace extracted", {
    userId,
    segments: pending.length,
    opsAppended,
    cacheHit,
    totalTokens,
  });

  return { segments: pending.length, opsAppended, cacheHit, totalTokens };
}

interface ExtractionReport {
  userId: string;
  extractionId: string;
  captureSessionId: string | undefined;
  segments: number;
  opsAppended: number;
  messages: ChatMessage[];
  rawResponse: string;
  parseError: string | null;
  parseWarningCount: number;
  /** Absent when the extraction cache answered and no model was called. */
  liveCall: ChatResult | undefined;
}

/**
 * Report one extraction to analytics.
 *
 * Emitted here at the call site rather than derived from the `extraction` table
 * afterwards, because `recordExtraction` uses `onConflictDoNothing`: when a
 * concurrent worker stored the identical call first, we still paid for the
 * model call but no row is ours. A row-driven reporter would lose exactly that
 * spend, which is the spend most worth knowing about.
 *
 * Nothing needs to guard against double-reporting on a pg-boss retry. A retry
 * after a successful call finds the row it just wrote and takes the cache
 * branch, so the extraction cache is already the idempotency mechanism.
 */
function reportExtraction(report: ExtractionReport): void {
  const {
    userId,
    extractionId,
    captureSessionId,
    segments,
    opsAppended,
    messages,
    rawResponse,
    parseError,
    parseWarningCount,
    liveCall,
  } = report;

  try {
    if (!liveCall) {
      // Deliberately not an $ai_generation: no model was called, so counting it
      // as one would invent both spend and latency. Tracked on its own because
      // cost avoided is worth seeing — `workspace:rebuild` replays an entire
      // transcript without a single call.
      capture(userId, "workspace_extraction_cached", {
        extraction_id: extractionId,
        segments,
        ops_appended: opsAppended,
      });
    } else {
      captureGeneration({
        distinctId: userId,
        traceId: extractionId,
        sessionId: captureSessionId,
        spanName: "workspace_extract",
        // The model that answered, not the one requested: aliases, wildcards
        // and fallbacks all mean those differ, and only this one is provenance.
        model: liveCall.resolvedModel,
        latencyMs: liveCall.latencyMs,
        input: messages,
        output: rawResponse,
        inputTokens: liveCall.usage.promptTokens,
        outputTokens: liveCall.usage.completionTokens,
        costUsd: liveCall.costUsd,
        error: parseError,
        properties: {
          prompt_version: PROMPT_VERSION,
          requested_model: liveCall.requestedModel,
          temperature: EXTRACTION_TEMPERATURE,
          seed: EXTRACTION_SEED,
          segment_count: segments,
          ops_appended: opsAppended,
          parse_warning_count: parseWarningCount,
          cache_hit: false,
        },
      });
    }

    if (parseError || parseWarningCount > 0) {
      capture(userId, "workspace_extraction_failed", {
        extraction_id: extractionId,
        parse_error: parseError,
        parse_warning_count: parseWarningCount,
      });
    }
  } catch (err) {
    // Analytics must never break extraction. The extraction row is already
    // committed and the ops are already appended by this point.
    log.warn("failed to report extraction", {
      extractionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Drain a user's whole backlog, one fixed-size batch at a time.
 *
 * Replays exactly the boundaries live extraction would have used, so a rebuild
 * hits the cache on every step and reproduces the same workspace. It also means
 * each batch after the first sees real prior state — which is what gives the
 * model anything to supersede. A single gulp of the whole transcript starts
 * from an empty workspace and can only ever add.
 */
export async function extractWorkspaceFully(
  userId: string,
  maxRuns = 2000,
): Promise<ExtractionOutcome[]> {
  const outcomes: ExtractionOutcome[] = [];

  for (let run = 0; run < maxRuns; run += 1) {
    const outcome = await extractWorkspace(userId);
    if (outcome.skipped) break;
    outcomes.push(outcome);
    // A short batch means the transcript is exhausted.
    if (outcome.segments < BATCH_SIZE) break;
  }

  return outcomes;
}

export type { TranscriptSegment };
