import { NextResponse } from "next/server";
import { and, captureSession, desc, eq, getDb } from "@voicemural/db";
import { CaptureSessionCreate } from "@voicemural/shared";
import { capture, sessionIdFrom } from "@/lib/analytics/server";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Open a capture session.
 *
 * The recorder generates the id client-side so it can start buffering chunks to
 * IndexedDB immediately, before the network has confirmed anything. Creation is
 * therefore idempotent — a retry after a dead zone must not open a second
 * session or orphan the chunks already queued against the first.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = CaptureSessionCreate.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const { id, startedAt, deviceInfo } = parsed.data;

  const existing = await db
    .select({ id: captureSession.id, userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, id))
    .limit(1);

  if (existing.length > 0) {
    // Someone else's session id: refuse rather than leak or overwrite.
    if (existing[0]?.userId !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    capture(
      userId,
      "capture_session_opened",
      { capture_session_id: id, resumed: true },
      { sessionId: sessionIdFrom(req) },
    );
    return NextResponse.json({ id, resumed: true });
  }

  await db.insert(captureSession).values({
    id,
    userId,
    startedAt,
    deviceInfo,
  });

  // Best-effort by nature: this route is never reached when a drive starts in a
  // dead zone, and nothing retries it. `capture_session_completed` from the
  // worker is the event to trust for counting drives.
  capture(
    userId,
    "capture_session_opened",
    { capture_session_id: id, resumed: false },
    { sessionId: sessionIdFrom(req) },
  );

  return NextResponse.json({ id, resumed: false }, { status: 201 });
}

/** Recent sessions for the signed-in user. */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const rows = await getDb()
    .select()
    .from(captureSession)
    .where(and(eq(captureSession.userId, userId)))
    .orderBy(desc(captureSession.startedAt))
    .limit(50);

  return NextResponse.json({ sessions: rows });
}
