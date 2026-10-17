import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { finishPart1, markConversationStarted } from "@voicemural/db/prolific";
import { ProlificPart1 } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";
import { completionCodeFor, completionUrlFor } from "@/lib/study/prolific-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The two moments of part 1 the server must know about: which drive is the
 * conversation (`started`), and its end with their judgement of how much they
 * will remember (`finished`). The answer to `finished` carries the completion
 * code — the only place a browser learns it.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = ProlificPart1.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };

  if (parsed.data.step === "started") {
    const { captureSessionId } = parsed.data;
    const [row] = await getDb()
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, captureSessionId))
      .limit(1);
    // The recorder registers the drive itself; this can arrive first. Not an
    // error: the page retries until the drive exists.
    if (!row) return NextResponse.json({ error: "not_yet" }, { status: 409, headers });
    if (row.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const marked = await markConversationStarted(userId, captureSessionId);
    if (!marked) return NextResponse.json({ error: "not_a_participant" }, { status: 409, headers });
    return NextResponse.json({ ok: true }, { headers });
  }

  const participant = await finishPart1(userId, parsed.data.judgmentOfLearning);
  if (!participant) return NextResponse.json({ error: "no_conversation" }, { status: 409, headers });
  return NextResponse.json(
    { ok: true, completionUrl: completionUrlFor(1), completionCode: completionCodeFor(1) },
    { headers },
  );
}
