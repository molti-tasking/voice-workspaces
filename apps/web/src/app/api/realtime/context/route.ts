import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import {
  pendingConfirmation,
  settleInvocation,
  type PendingConfirmation,
} from "@voicemural/db/repertoire";
import { resolveSpokenAnswer, type SpokenAnswer } from "@voicemural/shared";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { buildTurnContext } from "@voicemural/talkback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the driver has said before, for whoever is doing the talking.
 *
 * EXISTS FOR THE PYTHON BACKEND. `apps/pipecat` cannot call into the ledger
 * itself, so it reaches retrieval through here. Reimplementing it in Python
 * would mean two versions of the one thing that decides whether the agent knows
 * anything, and only one of them would get fixed.
 *
 * Returns PASSAGES and THREADS, not a finished prompt block. What was said earlier in this
 * drive is deliberately absent: it used to be read from the `utterance` ledger,
 * which trails live speech by 15-25 seconds because it is written by the batch
 * chunk pipeline — so the driver could ask about something they had just said
 * and be told it could not be found. The container keeps its own running
 * summary off the live STT stream instead, and it alone can assemble the final
 * block because it alone holds that summary.
 *
 * Authorised by the same short-lived ticket the WebSocket path uses, because
 * the Python container has no Better Auth session and should not gain one. The
 * ticket is bound to a drive, and ownership is RE-RESOLVED here against
 * `capture_session.userId` rather than trusted from the payload — a guest whose
 * account was upgraded mid-drive holds a ticket naming a user row that no
 * longer exists.
 *
 * It also carries any PENDING CONFIRMATION, piggybacked rather than given its
 * own endpoint. An outbound or irreversible action does not fire until the
 * person agrees, and the only channel to ask them is the conversation — so the
 * question has to reach the container on the turn path. A second round trip
 * here would double the pre-first-token cost on the one route whose entire
 * rationale is latency, to carry a row that is null almost every turn.
 */

/*
 * AND IT SETTLES THE ANSWER, on the same round trip, for the same reason.
 *
 * When the agent's last turn asked about a parked action, the container sends
 * that invocation's id as `answering` with the driver's next words. Those
 * words are resolved lexically (`resolveSpokenAnswer`) and a yes or no is
 * written BEFORE the pending row is read. The order is the point: settled
 * first, the question the driver just answered cannot be put back in front of
 * the model for the very turn that answers it. A separate settle endpoint
 * racing this one would re-ask a question the driver had just said yes to.
 *
 * Unclear settles nothing; the action stays pending and can be asked once more
 * (`MAX_CONFIRMATION_ASKS`). Settling does not fire anything — no outlet runs
 * on `confirmed = true` yet — so this records the decision the study measures,
 * and the action itself waits for outlets to exist.
 */

const Body = z.object({
  ticket: z.string().min(1),
  /** What the driver just said, which is the search query. */
  said: z.string().min(1).max(2000),
  /** The invocation the agent's previous turn asked about, if it asked. */
  answering: z.uuid().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyTicket(parsed.data.ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);

  const owner = rows[0]?.userId;
  if (!owner || owner !== payload.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  /* NOT single-use, unlike the WebSocket handshake.
   *
   * This is called once per conversational turn, so a replay guard would kill
   * the second turn of every drive. The ticket's own one-minute expiry is the
   * bound that matters, and the client refreshes it — the risk of a re-read of
   * the driver's own transcript, by a holder who already proved ownership of
   * the drive, is not worth ending the conversation over. */
  const [{ passages, threads, board }, { settled, pending }] = await Promise.all([
    buildTurnContext(payload.userId, payload.captureSessionId, parsed.data.said),
    settleThenReadPending(payload.captureSessionId, parsed.data.said, parsed.data.answering),
  ]);

  return NextResponse.json(
    // `threads` is where things stand on the topics this turn touches, from
    // the memory index; empty without MODEL_EMBED. `board` is the live fold of
    // the task board — the only part of the turn that answers "what should I do
    // next" with something actionable. The container orders them: board first,
    // then threads, then dated quotes.
    { passages, threads, board: board.text, pending, settled },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Both halves fail open, separately. An unanswered confirmation is worth
 * asking about, but not at the cost of the turn it would have been asked on;
 * and a settle that fails leaves the action pending, which is what "unclear"
 * does anyway.
 */
async function settleThenReadPending(
  captureSessionId: string,
  said: string,
  answering: string | undefined,
): Promise<{ settled: SpokenAnswer | null; pending: PendingConfirmation | null }> {
  let settled: SpokenAnswer | null = null;
  if (answering) {
    settled = resolveSpokenAnswer(said);
    if (settled !== "unclear") {
      const wrote = await settleInvocation(answering, settled === "yes", captureSessionId).catch(
        () => false,
      );
      // Already settled, another drive's, or the write failed: report what was
      // heard only when it took effect, so the container never believes a yes
      // landed that did not.
      if (!wrote) settled = null;
    }
  }
  const pending = await pendingConfirmation(captureSessionId).catch(() => null);
  return { settled, pending };
}
