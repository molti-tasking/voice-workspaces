import {
  agentDecision,
  agentDecisionOutcomeEnum,
  agentDecisionTriggerEnum,
  agentTurn,
  eq,
  floorEvent,
  floorEventKindEnum,
  getDb,
  sparkKindEnum,
  sql,
} from "@voicemural/db";
import { log } from "@voicemural/telemetry";

/**
 * Persist one system turn.
 *
 * This is the paper's data, and unlike the workspace it cannot be
 * reconstructed. `extraction` exists so the workspace can be rebuilt without
 * network calls; a live conversation has no such cache, because it depends on
 * wall-clock timing, VAD outcomes, network jitter and a sampler above
 * temperature 0. Routing talk-back through the extraction cache would poison a
 * cache whose entire value is that a replay makes no calls — so these rows are
 * the only record that a turn ever happened.
 *
 * Never throws. A conversation that fails to record a turn is a lost row; a
 * conversation that CRASHES because it could not record one takes the drive's
 * talk-back down with it, and capture must not be able to notice either way.
 */

export interface AgentTurnRecord {
  captureSessionId: string;
  /** For log attribution only — the row is keyed by session. */
  userId: string;
  seq: number;
  startOffsetMs: number;
  endOffsetMs: number;
  /** Whether `endOffsetMs` came from the transport or from `len(text) / 14`. */
  endOffsetMeasured?: boolean;
  kind?: "reply" | "proactive_prompt" | "confirmation_request" | "backchannel";
  /** What the user actually heard. Empty when a turn was cut off before playback. */
  text: string;
  /** What the model produced, spoken or not. */
  generatedText: string;
  respondingToText?: string;
  bargedIn?: boolean;
  truncatedAtMs?: number;
  requestedModel?: string;
  resolvedModel?: string;
  asrMs?: number;
  ttftMs?: number;
  speakTtfbMs?: number;
  totalLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Text, so "unknown" stays distinguishable from "free". */
  costUsd?: string;
  configVersion?: string;
  /** Tools the turn called before speaking, in order. */
  toolCalls?: { name: string; latencyMs: number; error?: string }[];
  error?: string;
}

/**
 * Returns the new row's id, so the decision that produced the turn can point
 * at it — or null when nothing was written: a duplicate seq, or a failure.
 */
export async function recordAgentTurn(record: AgentTurnRecord): Promise<string | null> {
  try {
    const rows = await getDb()
      .insert(agentTurn)
      .values({
        captureSessionId: record.captureSessionId,
        seq: record.seq,
        startOffsetMs: record.startOffsetMs,
        endOffsetMs: record.endOffsetMs,
        endOffsetMeasured: record.endOffsetMeasured ?? false,
        kind: record.kind ?? "reply",
        text: record.text,
        generatedText: record.generatedText,
        respondingToText: record.respondingToText,
        bargedIn: record.bargedIn ?? false,
        truncatedAtMs: record.truncatedAtMs,
        requestedModel: record.requestedModel,
        resolvedModel: record.resolvedModel,
        asrMs: record.asrMs,
        ttftMs: record.ttftMs,
        speakTtfbMs: record.speakTtfbMs,
        totalLatencyMs: record.totalLatencyMs,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        costUsd: record.costUsd,
        configVersion: record.configVersion,
        toolCalls: record.toolCalls ?? [],
        error: record.error,
      })
      // A reconnect restarts the turn counter, so a seq can repeat within a
      // drive. Dropping the duplicate is right: the conversation is ephemeral
      // and no downstream reader depends on a contiguous sequence.
      .onConflictDoNothing()
      .returning({ id: agentTurn.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    log.error("could not record agent turn", {
      captureSessionId: record.captureSessionId,
      userId: record.userId,
      seq: record.seq,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type AgentDecisionTrigger = (typeof agentDecisionTriggerEnum.enumValues)[number];
export type AgentDecisionOutcome = (typeof agentDecisionOutcomeEnum.enumValues)[number];

export interface AgentDecisionRecord {
  captureSessionId: string;
  /** For log attribution only. */
  userId: string;
  seq: number;
  offsetMs: number;
  /**
   * The moment this decision belongs to. Several completions can share one —
   * Pipecat runs inference more than once inside a user turn — and this is what
   * makes the log countable by moment rather than by row. See the counting rule
   * on `agentDecision` in the schema.
   */
  opportunitySeq?: number;
  /** Which completion this was within that moment, from 0. The last one wins. */
  attempt?: number;
  trigger: AgentDecisionTrigger;
  outcome: AgentDecisionOutcome;
  configVersion?: string;
  latencyMs?: number;
  subjectKey?: string;
  /** Whether `AnswerGuard` had to force this moment. See the column. */
  forcedAnswer?: boolean;
  /** Whether a poke's first completion declined and had to be re-run. */
  forcedPoke?: boolean;
  /** The spark a poke carried, if any. See the column. */
  sparkKind?: (typeof sparkKindEnum.enumValues)[number];
  agentTurnId?: string;
}

/**
 * Persist what the model did with one moment it was given, spoken or not.
 *
 * Never throws, for the reason `recordAgentTurn` never throws. Not idempotent
 * on seq: a reconnect restarts the container's counter, and unlike a turn a
 * decision has no audio interval an echo filter could double-count, so a
 * repeated seq is simply two moments.
 */
export async function recordAgentDecision(record: AgentDecisionRecord): Promise<void> {
  try {
    await getDb().insert(agentDecision).values({
      captureSessionId: record.captureSessionId,
      seq: record.seq,
      offsetMs: record.offsetMs,
      opportunitySeq: record.opportunitySeq,
      attempt: record.attempt ?? 0,
      trigger: record.trigger,
      outcome: record.outcome,
      configVersion: record.configVersion,
      latencyMs: record.latencyMs,
      subjectKey: record.subjectKey,
      forcedAnswer: record.forcedAnswer ?? false,
      forcedPoke: record.forcedPoke ?? false,
      sparkKind: record.sparkKind,
      agentTurnId: record.agentTurnId,
    });
  } catch (err) {
    log.error("could not record agent decision", {
      captureSessionId: record.captureSessionId,
      userId: record.userId,
      seq: record.seq,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export type FloorEventKind = (typeof floorEventKindEnum.enumValues)[number];

export interface FloorEventRecord {
  captureSessionId: string;
  /** For log attribution only. */
  userId: string;
  seq: number;
  offsetMs: number;
  kind: FloorEventKind;
  /** The floor a connection started with, not a press. See the column. */
  atConnect?: boolean;
  configVersion?: string;
}

/**
 * Persist one change of who may talk, as the container applied it.
 *
 * Never throws, for the reason `recordAgentTurn` never throws: the lock still
 * holds in the container whether or not its row lands, and a conversation must
 * not go down over its own bookkeeping.
 */
export async function recordFloorEvent(record: FloorEventRecord): Promise<void> {
  try {
    await getDb().insert(floorEvent).values({
      captureSessionId: record.captureSessionId,
      seq: record.seq,
      offsetMs: record.offsetMs,
      kind: record.kind,
      atConnect: record.atConnect ?? false,
      configVersion: record.configVersion,
    });
  } catch (err) {
    log.error("could not record floor event", {
      captureSessionId: record.captureSessionId,
      userId: record.userId,
      seq: record.seq,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Where a connection's three counters resume on this drive: turns, decisions,
 * floor changes.
 *
 * A reconnect mid-drive is a new connection with the same drive, and a counter
 * restarting at 0 collides with the rows already there — for turns, whose
 * `(capture_session_id, seq)` is unique, every later turn becomes a silent
 * no-op (see `nextDraftSeq` for the same story with drafts). Fails open to 0,
 * which is where a counter started before this existed.
 */
export async function nextRecordSeqs(
  captureSessionId: string,
): Promise<{ turn: number; decision: number; floor: number }> {
  const next = async (table: typeof agentTurn | typeof agentDecision | typeof floorEvent) => {
    const [row] = await getDb()
      .select({ seq: sql<number | null>`max(${table.seq})` })
      .from(table)
      .where(eq(table.captureSessionId, captureSessionId));
    return row?.seq === null || row?.seq === undefined ? 0 : Number(row.seq) + 1;
  };
  const [turn, decision, floor] = await Promise.all([
    next(agentTurn).catch(() => 0),
    next(agentDecision).catch(() => 0),
    next(floorEvent).catch(() => 0),
  ]);
  return { turn, decision, floor };
}
