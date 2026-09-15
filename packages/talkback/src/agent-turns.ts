import {
  agentDecision,
  agentDecisionOutcomeEnum,
  agentDecisionTriggerEnum,
  agentTurn,
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
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        costUsd: record.costUsd,
        configVersion: record.configVersion,
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
  trigger: AgentDecisionTrigger;
  outcome: AgentDecisionOutcome;
  configVersion?: string;
  latencyMs?: number;
  subjectKey?: string;
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
      trigger: record.trigger,
      outcome: record.outcome,
      configVersion: record.configVersion,
      latencyMs: record.latencyMs,
      subjectKey: record.subjectKey,
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
