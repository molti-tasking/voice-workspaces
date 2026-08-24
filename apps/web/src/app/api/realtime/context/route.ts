import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { buildContextMessage } from "@voicemural/talkback";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the driver has said before, for whoever is doing the talking.
 *
 * EXISTS FOR THE PYTHON BACKEND. The LiveKit agent calls `buildContextMessage`
 * in process; `apps/pipecat` cannot, so it reaches the same function through
 * here. Reimplementing retrieval in Python would mean two versions of the one
 * thing that decides whether the agent knows anything — and while the two
 * backends are being compared, a difference in recall would look like a
 * property of the framework instead of a bug in the copy.
 *
 * Authorised by the same short-lived ticket the WebSocket path uses, because
 * the Python container has no Better Auth session and should not gain one. The
 * ticket is bound to a drive, and ownership is RE-RESOLVED here against
 * `capture_session.userId` rather than trusted from the payload — a guest whose
 * account was upgraded mid-drive holds a ticket naming a user row that no
 * longer exists.
 */

const Body = z.object({
  ticket: z.string().min(1),
  /** What the driver just said, which is the search query. */
  said: z.string().min(1).max(2000),
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
  const context = await buildContextMessage(payload.userId, payload.captureSessionId, parsed.data.said);

  return NextResponse.json({ context }, { headers: { "Cache-Control": "no-store" } });
}
