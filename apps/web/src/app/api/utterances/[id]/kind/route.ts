import { NextResponse } from "next/server";
import { and, captureSession, eq, getDb, utterance } from "@voicemural/db";
import { currentUserId } from "@/lib/session";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({ kind: z.enum(["content", "directive"]) });

/**
 * Correct the classifier.
 *
 * Writes `kindOverride`, never `kind`. That is the whole asymmetry the design
 * rests on: the ledger records what the model decided, this records what the
 * person decided, and both survive — so the classifier's error rate stays
 * measurable after it has been corrected. Every reader takes
 * `kindOverride ?? kind`, which `loadPendingSegments` already does.
 *
 * Ownership is enforced in the WHERE clause via the session join rather than in
 * a guard clause, so there is no path that forgets it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();

  const owned = await db
    .select({ id: utterance.id })
    .from(utterance)
    .innerJoin(captureSession, eq(captureSession.id, utterance.captureSessionId))
    .where(and(eq(utterance.id, id), eq(captureSession.userId, userId)))
    .limit(1);

  if (owned.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db
    .update(utterance)
    .set({ kindOverride: parsed.data.kind })
    .where(eq(utterance.id, id));

  return NextResponse.json({ status: "ok", kind: parsed.data.kind });
}
