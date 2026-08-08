import {
  advanceCursor,
  appendOps,
  findCachedExtraction,
  loadOps,
  loadPendingSegments,
  recordExtraction,
  sessionIdsForUtterances,
} from "@voicemural/db/workspace";
import { chat, modelFor } from "@voicemural/llm";
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
import { log } from "../logger";

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
