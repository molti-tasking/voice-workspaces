import {
  agentDecision,
  agentDecisionOutcomeEnum,
  agentDecisionTriggerEnum,
  agentTurn,
  and,
  eq,
  getDb,
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
  kind?: "reply" | "proactive_prompt" | "confirmation_request" | "backchannel" | "filler";
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
  /** Whether `endOffsetMs` was measured at the speaker. See the column. */
  endMeasured?: boolean;
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
        endMeasured: record.endMeasured ?? false,
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

/**
 * Replace a turn's estimated end with the measured one.
 *
 * WHY A SECOND WRITE. The row has to exist the moment speech starts, because
 * `agent_turn` is the echo filter's only input and a turn it does not know
 * about comes back through the microphone as the participant's own words. But
 * the container cannot know when playback FINISHED until it finishes, which is
 * seconds later. So the row is written with the character-count estimate and
 * corrected here, and `end_measured` is what tells the two apart — before
 * this, every uninterrupted turn in the study carried `len(text) / 14` and
 * nothing said so.
 *
 * Scoped to the session as well as the id: the id came from this route, but a
 * write that trusts it alone would let one drive's ticket patch another's row.
 *
 * Never throws, for the reason `recordAgentTurn` never throws. A lost patch
 * costs one turn its measured end and leaves `end_measured` false, which is
 * exactly what the analysis needs to know.
 */
export async function finishAgentTurn(record: {
  id: string;
  captureSessionId: string;
  endOffsetMs: number;
  speakTtfbMs?: number;
}): Promise<boolean> {
  try {
    const rows = await getDb()
      .update(agentTurn)
      .set({
        endOffsetMs: record.endOffsetMs,
        endMeasured: true,
        ...(record.speakTtfbMs === undefined ? {} : { speakTtfbMs: record.speakTtfbMs }),
      })
      .where(
        and(
          eq(agentTurn.id, record.id),
          eq(agentTurn.captureSessionId, record.captureSessionId),
          // An interrupted turn's end is already measured — by the
          // interruption — and must not be moved by a late playback report.
          eq(agentTurn.bargedIn, false),
        ),
      )
      .returning({ id: agentTurn.id });
    return rows.length > 0;
  } catch (err) {
    log.error("could not record the measured end of an agent turn", {
      captureSessionId: record.captureSessionId,
      agentTurnId: record.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
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
  trigger: AgentDecisionTrigger;
  outcome: AgentDecisionOutcome;
  configVersion?: string;
  latencyMs?: number;
  subjectKey?: string;
  /** The MOMENT this decides. Rows sharing one are the same moment. */
  cueId?: string;
  agentTurnId?: string;
}

/**
 * Persist what the model did with one moment it was given, spoken or not.
 *
 * Never throws, for the reason `recordAgentTurn` never throws. Not idempotent
 * on seq: a reconnect restarts the container's counter, and unlike a turn a
 * decision has no audio interval an echo filter could double-count, so a
 * repeated seq is simply two moments.
 *
 * ONE MOMENT, ONE AUTHORITATIVE ROW. A single moment can run more than one
 * completion — a tool call and the answer that follows it, a turn ended twice,
 * an answer the guard makes the model try again — and each of them lands here
 * with the same `offsetMs`. Pilot 01 read as two `agent_decision` rows per
 * offset with nothing to say which was the turn and which was its shadow,
 * which doubles every rate computed over decisions.
 *
 * The rule, applied here rather than in the container so it holds even across
 * a reconnect: the FIRST decision of a moment is authoritative, unless a later
 * one SPOKE and the earlier ones did not — what the person heard is what the
 * moment became. The superseded rows are kept, marked, because how often one
 * moment runs two completions is itself a finding.
 */
export async function recordAgentDecision(record: AgentDecisionRecord): Promise<void> {
  try {
    const db = getDb();
    let authoritative = true;
    if (record.cueId) {
      const prior = await db
        .select({ outcome: agentDecision.outcome })
        .from(agentDecision)
        .where(
          and(
            eq(agentDecision.captureSessionId, record.captureSessionId),
            eq(agentDecision.cueId, record.cueId),
          ),
        );
      const spoke = record.outcome !== "declined";
      const priorSpoke = prior.some((p) => p.outcome !== "declined");
      authoritative = prior.length === 0 || (spoke && !priorSpoke);
      if (authoritative && prior.length > 0) {
        await db
          .update(agentDecision)
          .set({ authoritative: false })
          .where(
            and(
              eq(agentDecision.captureSessionId, record.captureSessionId),
              eq(agentDecision.cueId, record.cueId),
            ),
          );
      }
    }
    await db.insert(agentDecision).values({
      captureSessionId: record.captureSessionId,
      seq: record.seq,
      offsetMs: record.offsetMs,
      trigger: record.trigger,
      outcome: record.outcome,
      configVersion: record.configVersion,
      latencyMs: record.latencyMs,
      subjectKey: record.subjectKey,
      cueId: record.cueId,
      authoritative,
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
