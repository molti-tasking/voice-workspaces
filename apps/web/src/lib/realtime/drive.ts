import { captureSession, eq, getDb } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";

/**
 * Who a realtime ticket speaks for, and whether the drive it names is still
 * taking turns.
 *
 * WHY THIS IS A SHARED CHECK. `agent_turn` and `agent_decision` are the same
 * ledger written from two routes, and both of them were happy to accept a
 * write for a drive that had ended. On Pilot 01 the container spoke a turn
 * 52.6 seconds after Stop and this side wrote it down: the row sits in a
 * closed session's transcript, after `ended_at`, as evidence of a
 * conversation that had no listener.
 *
 * The container is fixed too — it cancels its timers when the peer goes away
 * — but the two fixes are not alternatives. The container is a separate
 * process on the other side of a network, and the ledger is the thing that
 * has to be right in six months. Refusing here is what makes "no turn is
 * spoken into a closed session" a property of the data rather than a property
 * of a timer.
 *
 * A DEBRIEF COUNTS AS OVER. Capture keeps running after Stop so the debrief
 * answers are recorded (see `capture_session.debrief_started_offset_ms`), but
 * the drive's conversation is finished: talk-back is disconnected in the
 * browser, and a turn arriving during those ninety seconds is a stray from a
 * container that has not noticed yet. It is refused for the same reason.
 *
 * 409 rather than 403, and that distinction is load-bearing: the container
 * reads it as "the drive is over, stop writing" and closes its recorder,
 * where 403 would read as a bad ticket and be retried.
 */

export type DriveAuth =
  | { ok: true; userId: string; captureSessionId: string }
  | { ok: false; status: 401 | 403 | 409; error: string };

export async function authoriseOpenDrive(ticket: string): Promise<DriveAuth> {
  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return { ok: false, status: 401, error: "bad_ticket" };
  }

  const rows = await getDb()
    .select({
      userId: captureSession.userId,
      endedAt: captureSession.endedAt,
      debriefStartedOffsetMs: captureSession.debriefStartedOffsetMs,
    })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);

  const row = rows[0];
  // Ownership is re-resolved rather than trusted from the payload, exactly as
  // the routes did before this helper existed.
  if (!row || row.userId !== payload.userId) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (row.endedAt !== null || row.debriefStartedOffsetMs !== null) {
    return { ok: false, status: 409, error: "session_ended" };
  }

  return { ok: true, userId: payload.userId, captureSessionId: payload.captureSessionId };
}

/**
 * The same ticket check WITHOUT the "still open" rule.
 *
 * For the one write that legitimately lands after the agent has stopped
 * talking: the measured end of a turn whose audio was still playing when the
 * drive closed. It corrects a row that already exists rather than adding a
 * new one to a finished transcript.
 */
export async function authoriseDrive(
  ticket: string,
): Promise<Exclude<DriveAuth, { status: 409 }>> {
  const auth = await authoriseOpenDrive(ticket);
  if (auth.ok || auth.status !== 409) return auth as Exclude<DriveAuth, { status: 409 }>;
  const payload = verifyTicket(ticket);
  return { ok: true, userId: payload.userId, captureSessionId: payload.captureSessionId };
}
