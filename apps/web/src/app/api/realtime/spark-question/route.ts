import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb, sparkKindEnum } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { cleanSparkQuestion, sparkQuestionMessages } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One targeted question for a spark on offer (spark-question.ts): the
 * recorder sends the subject's title and its last lines, from the
 * conversation it already holds, and gets back a question naming what the
 * subject is actually about — or `null`, and the chip keeps its generic label.
 *
 * Session-authorised, with ownership of the drive re-resolved. Nothing is
 * stored: the question reaches the agent with the pull, and what it then
 * says is an `agent_turn` like any other.
 */
const Body = z.object({
  captureSessionId: z.uuid(),
  kind: z.enum(sparkKindEnum.enumValues),
  title: z.string().trim().min(1).max(160),
  lines: z
    .array(z.object({ who: z.enum(["user", "agent"]), text: z.string().max(2000) }))
    .max(40),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, kind, title, lines } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await chat(sparkQuestionMessages(kind, title, lines), {
      role: "fast",
      temperature: 0.3,
      maxTokens: 80,
      signal: AbortSignal.timeout(10_000),
      metadata: { generation_name: "spark_question", session_id: captureSessionId },
    });
    return NextResponse.json({ question: cleanSparkQuestion(result.content) }, { headers });
  } catch (err) {
    // A chip with its generic label is a working chip.
    console.warn("spark question failed — the chip keeps its label", { captureSessionId, kind, err: String(err) });
    return NextResponse.json({ question: null }, { headers });
  }
}
