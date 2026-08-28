import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { z } from "zod";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mint a short-lived ticket authorising a realtime WebSocket connection.
 *
 * The realtime service does not share this app's session handling — see the
 * reasoning in packages/shared/src/realtime-ticket.ts. This route is the one
 * place that has a Better Auth session AND the shared signing secret, so it is
 * where the two meet.
 *
 * Ownership of the drive is checked HERE, while a database connection is
 * already at hand, rather than in the realtime service. The service still
 * re-resolves it on connect, but a ticket that was never valid should not be
 * issued in the first place.
 */

const Body = z.object({
  captureSessionId: z.uuid(),
  /**
   * A ticket for the per-turn context endpoint rather than for a handshake.
   *
   * Lives as long as a drive, because it is spent once per conversational turn
   * and a one-minute credential would end the conversation after the first
   * exchange. See the reasoning on `ttlMs` in realtime-ticket.ts.
   */
  scope: z.enum(["handshake", "context"]).default("handshake"),
});

/** Long enough for a drive, and no longer. */
const CONTEXT_TICKET_TTL_MS = 3 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { captureSessionId, scope } = parsed.data;

  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);

  const owner = rows[0]?.userId;

  // A drive that has not been registered yet is the normal case, not an error:
  // the recorder generates the session id client-side and starts buffering
  // before the network confirms anything, so in a dead zone the row genuinely
  // does not exist yet. Refusing here would make talk-back unavailable for
  // exactly the drives most worth capturing. The realtime service re-checks
  // once the row appears.
  if (owner && owner !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { ticket, expiresAt } = issueTicket(
      { userId, captureSessionId },
      scope === "context" ? { ttlMs: CONTEXT_TICKET_TTL_MS } : {},
    );
    return NextResponse.json(
      { ticket, expiresAt },
      // Never cached, never stored: it is a single-use credential with a
      // one-minute life, and it travels in a URL.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Thrown when BETTER_AUTH_SECRET is unset. Talk-back is simply unavailable;
    // say so plainly rather than as a 500, because capture is unaffected.
    return NextResponse.json({ error: "talkback_unavailable" }, { status: 503 });
  }
}
