import { captureSession, eq, getDb } from "@voicemural/db";

/**
 * Who owns this drive, and whether it is still running.
 *
 * TWO CHECKS, ONE PLACE, because they are asked together on every route the
 * container writes a session record through and the answer has to be the same
 * on all of them.
 *
 * Ownership is re-resolved rather than trusted: the ticket says who the caller
 * is, and the row says whose session it is, and a route that only checked the
 * first would take a valid ticket for one drive as authority over another.
 *
 * `endedAt` is the newer half. A drive is over when Stop on `/record` posts to
 * `/api/capture-sessions/[id]/end`, or when the worker's idle sweep closes a
 * session that went quiet — and after that the session is a finished record,
 * not a place to write. On the first formative pilot (19 Sep 2026) it was
 * written to anyway: `agent_turn` seq 14 starts 52 seconds after `ended_at`,
 * a `silence_offer` whose timer outlived the Stop. One row, and it corrupts
 * every turn count and every duration taken from that session — and it was an
 * offer to do something the participant had already said yes to 99 seconds
 * earlier, which is the other pilot failure surfacing a second time.
 *
 * REJECTED, NOT DROPPED. Failing open is right on the conversational path — an
 * agent that has forgotten the past is worth more than one that stops talking —
 * but failing open QUIETLY is how a whole drive gets recorded against a
 * mistake nobody can explain afterwards. The refusal is a status the container
 * can read and a line in the log, and the container uses the first to stop
 * trying (see `TurnRecorder._post` and `Offers._fire` in `bot.py`).
 *
 * NOT applied to `/board` or `/search`. What those write is the participant's
 * own workspace, which outlives any one drive and carries a session id only
 * for attribution; this rule is about rows that ARE the session's record.
 */
export type LiveSession =
  | { live: true }
  | { live: false; status: 403 | 409; error: "forbidden" | "session_ended" };

export async function resolveLiveSession(
  route: string,
  captureSessionId: string,
  userId: string,
): Promise<LiveSession> {
  const rows = await getDb()
    .select({ userId: captureSession.userId, endedAt: captureSession.endedAt })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);

  const row = rows[0];
  if (row?.userId !== userId) return { live: false, status: 403, error: "forbidden" };
  if (row.endedAt) {
    console.warn(
      `[realtime] refused a ${route} write for ${captureSessionId}: the session ended at ` +
        `${row.endedAt.toISOString()}. The container is still talking into a drive that is over.`,
    );
    return { live: false, status: 409, error: "session_ended" };
  }
  return { live: true };
}
