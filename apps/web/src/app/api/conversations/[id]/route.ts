import { NextResponse } from "next/server";
import { z } from "zod";
import { loadConversation } from "@voicemural/db/conversation";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whole conversation a drive belongs to, drive by drive — what the
 * recorder replays onto the screen when it continues one
 * (`continueRecording` in capture-provider.tsx; `replay.ts`).
 *
 * Session-authorised, and only the person's own drives: anything else is a
 * 404. Content, so never cached and never logged.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const drives = await loadConversation(userId, id);
  if (!drives) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    {
      drives: drives.map((d) => ({
        id: d.id,
        lines: d.lines.map(({ who, startMs, endMs, text }) => ({ who, startMs, endMs, text })),
        visits: d.visits.map(({ ordinal, title, startMs }) => ({ ordinal, title, startMs })),
        subjects: d.subjects,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
