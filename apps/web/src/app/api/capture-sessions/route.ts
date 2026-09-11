import { NextResponse } from "next/server";
import { and, captureSession, desc, eq, getDb } from "@voicemural/db";
import { CaptureSessionCreate } from "@voicemural/shared";
import { asVoiceId } from "@voicemural/talkback/voice";
import { asSttLanguage } from "@voicemural/talkback/language";
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
  const { id, startedAt, deviceInfo, setting } = parsed.data;
  // Narrowed to the catalogue, never rejected: a stale browser offering a voice
  // that has since been retired must still be able to register its recording.
  // Unknown becomes null, which the container reads as "use the fallback".
  const voiceId = asVoiceId(parsed.data.voiceId);
  // Same narrowing, different meaning for null: "auto-detect", which both
  // transcription paths treat as the default anyway.
  const sttLanguage = asSttLanguage(parsed.data.sttLanguage);

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
    // The setting is deliberately NOT updated on a resumed session. It governs
    // turn-taking and how much went on screen for the whole recording, and a
    // session whose second half was interpreted under different rules is not
    // interpretable at all.
    capture(
      userId,
      "capture_session_opened",
      { capture_session_id: id, resumed: true },
      { sessionId: sessionIdFrom(req) },
    );
    return NextResponse.json({ id, resumed: true });
  }

  // Conflict-safe rather than check-then-insert: two concurrent creates of
  // the same id (a client retry racing its own timed-out request) would else
  // both pass the `existing` check above and the loser would surface a unique
  // violation as a 500 — which the recorder reads as "offline" and retries
  // forever. Every other write in the system resolves this with
  // onConflictDoNothing; this route is the odd one out no longer.
  const inserted = await db
    .insert(captureSession)
    .values({
      id,
      userId,
      startedAt,
      deviceInfo,
      setting,
      voiceId,
      sttLanguage,
    })
    .onConflictDoNothing({ target: captureSession.id })
    .returning({ id: captureSession.id });

  if (inserted.length === 0) {
    // Lost the race — the concurrent create won. Same reply as the resume
    // path above, including the ownership refusal if the id is somehow
    // someone else's.
    const [row] = await db
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, id))
      .limit(1);

    if (row?.userId !== userId) {
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

  // Best-effort by nature: when a drive starts in a dead zone this route is
  // not reached until the uploader replays the registration from IndexedDB
  // (see ensureSessionRegistered in the recorder's uploader). Even then the
  // event can be lost with the phone; `capture_session_completed` from the
  // worker is the event to trust for counting drives.
  capture(
    userId,
    "capture_session_opened",
    { capture_session_id: id, resumed: false, setting: setting ?? null, voice_id: voiceId, stt_language: sttLanguage },
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
