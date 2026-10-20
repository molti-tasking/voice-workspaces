import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { mirrorMessages, parseMirrorBullets } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One topic of the conversation as the mirror shows it (mirror.ts in
 * @voicemural/talkback): the recorder sends the topic's title and its lines,
 * from the conversation it already holds, and gets back a few short points per
 * side — what the person said, what the assistant said — or `null`, and the
 * mirror keeps what it showed before.
 *
 * Session-authorised, with ownership of the drive re-resolved, like
 * `/api/realtime/spark-question`. Nothing is stored.
 */
const Body = z.object({
  captureSessionId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  lines: z
    .array(z.object({ who: z.enum(["user", "agent"]), text: z.string().max(4000) }))
    .min(1)
    .max(60),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, title, lines } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await chat(mirrorMessages(title, lines), {
      role: "fast",
      temperature: 0.2,
      maxTokens: 220,
      signal: AbortSignal.timeout(12_000),
      metadata: { generation_name: "mirror_bullets", session_id: captureSessionId },
    });
    return NextResponse.json({ bullets: parseMirrorBullets(result.content) }, { headers });
  } catch (err) {
    // The topic keeps its title and whatever points it had.
    console.warn("mirror bullets failed — the topic keeps what it had", { captureSessionId, err: String(err) });
    return NextResponse.json({ bullets: null }, { headers });
  }
}
