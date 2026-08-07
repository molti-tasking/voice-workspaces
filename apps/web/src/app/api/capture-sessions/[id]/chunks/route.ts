import { NextResponse } from "next/server";
import { and, audioChunk, captureSession, eq, getDb } from "@voicemural/db";
import { ChunkUploadMeta, extensionForMime } from "@voicemural/shared";
import { chunkKey, fingerprint, getStorage } from "@voicemural/shared/storage";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
// Uploads are never cached or prerendered.
export const dynamic = "force-dynamic";

const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

/**
 * Accept one audio chunk.
 *
 * This is the most failure-prone path in the system: it runs on a phone, over
 * mobile data, on a road with dead zones. Two properties matter more than
 * throughput here.
 *
 * 1. **Idempotent.** The recorder retries from its IndexedDB queue and cannot
 *    know whether a timed-out request landed. Re-uploading a stored seq returns
 *    200 with `duplicate: true` so the recorder frees its local copy.
 * 2. **Durable before acknowledged.** Audio is written to storage before the row
 *    is committed, so an acked chunk always has bytes behind it. The recorder
 *    deletes its only other copy on the strength of this response.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { id: captureSessionId } = await params;
  const db = getDb();

  const owner = await db
    .select({ id: captureSession.id })
    .from(captureSession)
    .where(
      and(eq(captureSession.id, captureSessionId), eq(captureSession.userId, userId)),
    )
    .limit(1);

  if (owner.length === 0) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  const parsed = ChunkUploadMeta.safeParse({
    seq: form.get("seq"),
    startOffsetMs: form.get("startOffsetMs"),
    durationMs: form.get("durationMs"),
    mimeType: form.get("mimeType"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_meta", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const meta = parsed.data;

  if (file.size === 0) {
    return NextResponse.json({ error: "empty_audio" }, { status: 400 });
  }
  if (file.size > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "chunk_too_large" }, { status: 413 });
  }

  // Return early on a replay before doing any storage work.
  const existing = await db
    .select({ id: audioChunk.id, seq: audioChunk.seq })
    .from(audioChunk)
    .where(
      and(
        eq(audioChunk.captureSessionId, captureSessionId),
        eq(audioChunk.seq, meta.seq),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return NextResponse.json({
      chunkId: existing[0].id,
      seq: existing[0].seq,
      duplicate: true,
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = extensionForMime(meta.mimeType);
  const key = chunkKey(captureSessionId, meta.seq, extension);

  // Storage first: a row without bytes would be transcribed into nothing and
  // marked failed, whereas bytes without a row are simply swept up later.
  await getStorage().put(key, bytes);

  try {
    const [row] = await db
      .insert(audioChunk)
      .values({
        captureSessionId,
        seq: meta.seq,
        startOffsetMs: meta.startOffsetMs,
        durationMs: meta.durationMs,
        mimeType: meta.mimeType,
        byteSize: bytes.byteLength,
        checksum: fingerprint(bytes),
        storageKey: key,
        status: "stored",
      })
      .onConflictDoNothing({
        target: [audioChunk.captureSessionId, audioChunk.seq],
      })
      .returning({ id: audioChunk.id, seq: audioChunk.seq });

    if (!row) {
      // Lost a race with a concurrent retry of the same seq — that upload won.
      const [winner] = await db
        .select({ id: audioChunk.id, seq: audioChunk.seq })
        .from(audioChunk)
        .where(
          and(
            eq(audioChunk.captureSessionId, captureSessionId),
            eq(audioChunk.seq, meta.seq),
          ),
        )
        .limit(1);

      return NextResponse.json({
        chunkId: winner?.id ?? null,
        seq: meta.seq,
        duplicate: true,
      });
    }

    return NextResponse.json(
      { chunkId: row.id, seq: row.seq, duplicate: false },
      { status: 201 },
    );
  } catch (err) {
    // Do not delete the stored object: the bytes are the irreplaceable half.
    console.error("Failed to record chunk row", { captureSessionId, seq: meta.seq }, err);
    return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  }
}
