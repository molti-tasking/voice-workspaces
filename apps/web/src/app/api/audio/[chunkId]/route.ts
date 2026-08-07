import { and, audioChunk, captureSession, eq, getDb } from "@voicemural/db";
import { getStorage } from "@voicemural/shared/storage";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Serve a chunk's audio for playback in the Workspace.
 *
 * Joins through capture_session so a chunk is only ever readable by the person
 * who recorded it — these are private recordings of someone thinking aloud.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ chunkId: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return new Response("Unauthorised", { status: 401 });

  const { chunkId } = await params;

  const [chunk] = await getDb()
    .select({
      storageKey: audioChunk.storageKey,
      mimeType: audioChunk.mimeType,
      byteSize: audioChunk.byteSize,
    })
    .from(audioChunk)
    .innerJoin(captureSession, eq(audioChunk.captureSessionId, captureSession.id))
    .where(and(eq(audioChunk.id, chunkId), eq(captureSession.userId, userId)))
    .limit(1);

  if (!chunk) return new Response("Not found", { status: 404 });

  try {
    const data = await getStorage().get(chunk.storageKey);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": chunk.mimeType,
        "Content-Length": String(chunk.byteSize),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Audio missing from storage", { status: 410 });
  }
}
