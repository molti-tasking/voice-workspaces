import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import { cleanTitle, parseSettled, settledMessages, titleMessages } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The two calls `TopicTitle` made in the container, for an engine that has no
 * container (`use-realtime.ts`): what the conversation is about now, and
 * whether a subject it has just left was settled. Same prompts, same model
 * (`summarise`, which falls back to `converse`), same cleaning.
 *
 * Only the call: the browser keeps the titles, ordinals and visits, as the
 * container did, and writes them through `/title` and `/subject` with the
 * drive's ticket. Nothing is stored here.
 */

const Body = z.object({
  captureSessionId: z.uuid(),
  name: z
    .object({
      current: z.string().trim().min(1).max(64).nullable(),
      earlier: z.array(z.string().trim().min(1).max(64)).max(16),
      recent: z.string().trim().min(1).max(1200),
    })
    .optional(),
  settled: z
    .object({
      title: z.string().trim().min(1).max(64),
      said: z.string().trim().min(1).max(1600),
    })
    .optional(),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.name === !parsed.data.settled)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { captureSessionId, name, settled } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const metadata = (call: string) => ({
    generation_name: call,
    trace_name: call,
    tags: ["talkback", call, "realtime"],
    session_id: captureSessionId,
  });
  try {
    if (name) {
      const { content } = await chat(titleMessages(name.current, name.earlier, name.recent), {
        role: "summarise",
        temperature: 0,
        maxTokens: 16,
        signal: AbortSignal.timeout(10_000),
        metadata: metadata("talkback.title"),
      });
      return NextResponse.json({ title: cleanTitle(content, name.current) });
    }
    const { content } = await chat(settledMessages(settled!.title, settled!.said), {
      role: "summarise",
      temperature: 0,
      maxTokens: 4,
      signal: AbortSignal.timeout(10_000),
      metadata: metadata("talkback.settled"),
    });
    return NextResponse.json({ settled: parseSettled(content) });
  } catch (err) {
    // The titler retries on its next trigger, against a window that still
    // holds this speech; a board is not worth more than that.
    console.warn("[realtime] topic call failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
