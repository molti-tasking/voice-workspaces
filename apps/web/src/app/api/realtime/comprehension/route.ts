import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { comprehensionMessages, parseComprehension } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The comprehension monitor's one call (DRAFT, `comprehension.ts`): the
 * screen sends one topic's title, its lines and the local signals it already
 * computed, and gets back which ideas on it are held, borrowed or shaky, and
 * at most one check question — or `null`, and the screen shows nothing new.
 *
 * Session-authorised, with ownership of the drive re-resolved, like
 * `/api/realtime/spark-question`. Nothing is stored: the judgement is a
 * suggestion on the screen, and the check only becomes anything when the
 * person pulls it and the agent asks it (an `agent_turn` like any other).
 */
const Body = z.object({
  captureSessionId: z.uuid(),
  ordinal: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  lines: z
    .array(z.object({ who: z.enum(["user", "agent"]), text: z.string().max(2000) }))
    .min(1)
    .max(60),
  evidence: z.object({
    agentShare: z.number().min(0).max(1).nullable(),
    hesitation: z.enum(["low", "mid", "high"]).nullable(),
    settled: z.boolean().nullable(),
    restated: z.boolean(),
  }),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, ordinal, title, lines, evidence } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  try {
    const result = await chat(comprehensionMessages(title, lines, evidence), {
      role: "fast",
      temperature: 0.2,
      maxTokens: 500,
      signal: AbortSignal.timeout(15_000),
      metadata: { generation_name: "comprehension_monitor", session_id: captureSessionId },
    });
    return NextResponse.json({ comprehension: parseComprehension(result.content, ordinal) }, { headers });
  } catch (err) {
    console.warn("comprehension monitor failed — the screen shows nothing new", { captureSessionId, err: String(err) });
    return NextResponse.json({ comprehension: null }, { headers });
  }
}
