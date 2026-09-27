import { NextResponse } from "next/server";
import { and, audioChunk, captureSession, eq, getDb, isNotNull } from "@voicemural/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Put a session's failed chunks back in the transcription queue.
 *
 * The session page has always said failed audio "can be retried", and nothing
 * could: a chunk marked `failed` was never looked at again, because the worker
 * only picks up `stored` ones and the sweep only rescues `transcribing` ones.
 * Setting them back to `stored` is all a retry needs — the worker's poll finds
 * them within seconds.
 *
 * Only chunks that still have their audio. A chunk whose file is gone cannot be
 * transcribed however many times it is queued.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const [owned] = await db
    .select({ id: captureSession.id })
    .from(captureSession)
    .where(and(eq(captureSession.id, id), eq(captureSession.userId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const requeued = await db
    .update(audioChunk)
    .set({ status: "stored", failureReason: null, transcribeStartedAt: null })
    .where(
      and(
        eq(audioChunk.captureSessionId, id),
        eq(audioChunk.status, "failed"),
        isNotNull(audioChunk.storageKey),
      ),
    )
    .returning({ id: audioChunk.id });

  return NextResponse.json({ id, requeued: requeued.length });
}
