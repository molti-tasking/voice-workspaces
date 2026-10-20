import { NextResponse } from "next/server";
import { z } from "zod";
import { and, captureSession, eq, getDb } from "@voicemural/db";
import { renameSubject } from "@voicemural/db/subjects";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rename one subject of a drive: their own name for it, in place of the one
 * the container gave it (talkback-23). Kept on `drive_subject.title`, which
 * the recall probe and My week read.
 *
 * Session-authorised, with ownership of the drive re-resolved here, and NOT
 * refused once the drive has ended: the conversation stays on the recorder
 * after Stop, and that is a good moment to tidy its headlines. The title is
 * content and never logged.
 */
const Body = z.object({
  ordinal: z.number().int().min(1).max(10_000),
  title: z.string().min(1).max(200),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  const { id } = await params;
  if (!parsed.success || !z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [owned] = await getDb()
    .select({ id: captureSession.id })
    .from(captureSession)
    .where(and(eq(captureSession.id, id), eq(captureSession.userId, userId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const renamed = await renameSubject({ captureSessionId: id, ...parsed.data });
  return NextResponse.json({ renamed });
}
