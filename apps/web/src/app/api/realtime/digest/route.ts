import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { digestMessages, parseDigest } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The conversation digest the views read (`digest.ts` in
 * @voicemural/talkback): the screen sends the topics and lines it already
 * holds — live, or a stored conversation scrolled back to some point — and
 * gets back the Now line, each topic's points and ideas, and the open
 * questions; or `null`, and the screen keeps what it showed.
 *
 * Session-authorised, with ownership of the drive re-resolved, like
 * `/api/realtime/spark-question`. Nothing is stored: the same conversation at
 * the same point can always be digested again.
 */
const Body = z.object({
  captureSessionId: z.uuid(),
  topics: z
    .array(z.object({ ordinal: z.number().int().positive(), title: z.string().trim().min(1).max(160) }))
    .max(60),
  lines: z
    .array(
      z.object({
        who: z.enum(["user", "agent"]),
        text: z.string().max(4000),
        ordinal: z.number().int().positive().nullable(),
      }),
    )
    .min(1)
    .max(600),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, topics, lines } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await chat(digestMessages(topics, lines), {
      role: "fast",
      temperature: 0.2,
      maxTokens: 700,
      signal: AbortSignal.timeout(15_000),
      metadata: { generation_name: "conversation_digest", session_id: captureSessionId },
    });
    const digest = parseDigest(
      result.content,
      topics.map((t) => t.ordinal),
    );
    return NextResponse.json({ digest }, { headers });
  } catch (err) {
    // The screen keeps whatever it showed.
    console.warn("conversation digest failed — the screen keeps what it had", {
      captureSessionId,
      err: String(err),
    });
    return NextResponse.json({ digest: null }, { headers });
  }
}
