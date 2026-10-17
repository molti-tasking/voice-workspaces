import { NextResponse } from "next/server";
import { enrollParticipant } from "@voicemural/db/prolific";
import { ProlificEnroll } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";
import { prolificConfig } from "@/lib/study/prolific-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consent given: enrol this guest account as the Prolific participant named
 * by the PID, and assign the arm (`enrollParticipant`). The page creates the
 * guest first, so a session always exists here.
 *
 * 409 `other_participant`: this browser already holds another PID's account
 * (a researcher testing twice); the page signs out, makes a fresh guest and
 * asks again. 409 `enrolled_elsewhere`: the conversation began in another
 * browser, and part 1 does not start over.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const config = prolificConfig();
  if (!config.configured) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const parsed = ProlificEnroll.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { pid, studyId, sessionId, arm } = parsed.data;
  if (arm && !config.allowArmParam) {
    console.warn("ignoring a pinned Prolific arm: PROLIFIC_ALLOW_ARM_PARAM is off", { userId });
  }

  const result = await enrollParticipant({
    pid,
    userId,
    studyId,
    sessionId,
    task: config.task,
    recallDelayHours: config.recallDelayHours,
    arm: config.allowArmParam ? arm : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json(
    {
      ok: true,
      arm: result.participant.arm,
      task: result.participant.task,
      part1Done: result.participant.part1CompletedAt !== null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
