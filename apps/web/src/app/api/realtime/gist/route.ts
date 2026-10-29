import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { parseTurnGist, turnGistMessages } from "@voicemural/talkback/digest";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One turn's gist, the moment it is over (`turnGistMessages` in
 * @voicemural/talkback/digest): its line of at most eight words, two words and
 * one. The screen asks as soon as the next turn begins, so the turn just
 * answered is shown as its gist while the answer is still being said — the
 * conversation digest, which writes gists too, waits for the conversation to
 * stand still. Whichever comes first stays (`settleGists`).
 *
 * Session-authorised, with ownership of the drive re-resolved, like
 * `/api/realtime/digest`. Nothing is stored. `{ gist: null }` when the model
 * gave nothing usable; the screen keeps its own shortening.
 */
const Line = z.object({ who: z.enum(["user", "agent"]), text: z.string().trim().min(1).max(4000) });
const Body = z.object({
  captureSessionId: z.uuid(),
  seq: z.number().int().nonnegative(),
  turn: Line,
  before: Line.nullable().optional(),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, seq, turn, before } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await chat(turnGistMessages({ ...turn, before: before ?? null }), {
      role: "fast",
      temperature: 0.2,
      maxTokens: 120,
      // Late is no use: by then the digest has written it, or the turn has scrolled on.
      signal: AbortSignal.timeout(8_000),
      metadata: { generation_name: "turn_gist", session_id: captureSessionId },
    });
    return NextResponse.json({ gist: parseTurnGist(result.content, seq) }, { headers });
  } catch (err) {
    console.warn("turn gist failed — the screen keeps its own shortening", { captureSessionId, err: String(err) });
    return NextResponse.json({ gist: null }, { headers });
  }
}
