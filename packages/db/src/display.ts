/**
 * What the secondary display reads.
 *
 * Every byte comes from Postgres — `workspace_op` for the content lane,
 * `directive` for the directions lane — and never from the voice container.
 * That is the whole design: kill Pipecat mid-recording and the panel keeps
 * filling, because it was never downstream of the conversation in the first
 * place. The acceptance criterion for talk-back ("the ledger is durable, the
 * conversation is ephemeral") applies to the screen too.
 */
import { and, asc, desc, eq, gte, max, sql } from "drizzle-orm";
import { getDb } from "./index";
import { captureSession, directive, utterance, workspaceOp } from "./schema";

export interface LiveSession {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  setting: "driving" | "walking" | "hands_busy" | "desk" | null;
}

/** The session, if it belongs to this user. Null is a 404, not an error. */
export async function loadLiveSession(
  userId: string,
  captureSessionId: string,
): Promise<LiveSession | null> {
  const rows = await getDb()
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      setting: captureSession.setting,
    })
    .from(captureSession)
    .where(and(eq(captureSession.id, captureSessionId), eq(captureSession.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface DirectionCue {
  utteranceId: string;
  verb: string;
  restatement: string;
  resolved: boolean;
  createdAt: Date;
}

/**
 * Directions detected in this session, newest last.
 *
 * The fast lane: the classifier runs per chunk, so these land ~15-25s behind
 * speech, against ~40-90s for the content lane. The two are kept apart rather
 * than merged because that difference is real and a single list would hide it.
 */
export async function loadSessionDirections(
  captureSessionId: string,
  limit = 20,
): Promise<DirectionCue[]> {
  const rows = await getDb()
    .select({
      utteranceId: directive.utteranceId,
      verb: directive.verb,
      restatement: directive.restatement,
      capabilityId: directive.capabilityId,
      createdAt: directive.createdAt,
    })
    .from(directive)
    .where(eq(directive.captureSessionId, captureSessionId))
    .orderBy(desc(directive.createdAt))
    .limit(limit);

  return rows
    .map((r) => ({
      utteranceId: r.utteranceId,
      verb: r.verb,
      restatement: r.restatement,
      resolved: r.capabilityId !== null,
      createdAt: r.createdAt,
    }))
    .reverse();
}

/**
 * A cheap fingerprint of everything the panel can show.
 *
 * The stream compares this rather than re-running the two loads, so a quiet
 * minute costs one small query every few seconds instead of folding the whole
 * op log. Both halves are needed: content moves when extraction commits ops,
 * directions move when the classifier commits rows, and neither implies the
 * other.
 */
export async function cueVersion(
  userId: string,
  captureSessionId: string,
): Promise<string> {
  const db = getDb();

  const [ops] = await db
    .select({ seq: max(workspaceOp.seq) })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId));

  const [dirs] = await db
    .select({ n: sql<number>`count(*)`, last: max(directive.createdAt) })
    .from(directive)
    .where(eq(directive.captureSessionId, captureSessionId));

  return [
    ops?.seq ?? 0,
    Number(dirs?.n ?? 0),
    dirs?.last ? new Date(dirs.last).getTime() : 0,
  ].join(":");
}

/**
 * Utterances in this session still waiting on a verdict.
 *
 * Not shown as a cue — a line nobody has classified is not yet either kind —
 * but counted, so the panel can stay honest about being behind rather than
 * looking finished. See `rules.ts`: no spinner, but no pretending either.
 */
export async function countUnclassified(captureSessionId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(utterance)
    .where(
      and(eq(utterance.captureSessionId, captureSessionId), eq(utterance.kind, "unclassified")),
    );
  return Number(row?.n ?? 0);
}

/** Ops appended since a moment, oldest first. Used to bound the content fold. */
export async function opsSince(userId: string, since: Date) {
  return getDb()
    .select({ seq: workspaceOp.seq, occurredAt: workspaceOp.occurredAt })
    .from(workspaceOp)
    .where(and(eq(workspaceOp.userId, userId), gte(workspaceOp.occurredAt, since)))
    .orderBy(asc(workspaceOp.seq))
    .limit(1);
}
