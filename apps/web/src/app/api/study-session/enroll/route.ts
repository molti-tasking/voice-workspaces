import { NextResponse } from "next/server";
import { claimSession, findSessionByUser, progressOf } from "@voicemural/db/study-session";
import { SessionEnroll, resumeAt } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consent given on a session's link: the session becomes this account's
 * (`claimSession`). The page makes a guest first, so a session always exists
 * here. Answers where to pick up, which is the start for a new participant
 * and their place for one who reloaded.
 *
 * 404 `unknown`: no session has this code. 409 `not_a_guest`, `other_session`
 * or `claimed_elsewhere`: the page says what to do (a private window, or the
 * other browser).
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = SessionEnroll.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await claimSession({
    code: parsed.data.code,
    userId,
    // Off by default: a real account's drives reach its workspace, memory and
    // the field study's export. A researcher trying the session as themself
    // switches it on knowingly.
    allowAccounts: process.env.STUDY_SESSION_ALLOW_ACCOUNTS === "true",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "unknown" ? 404 : 409 });
  }

  const state = await findSessionByUser(userId);
  return NextResponse.json(
    { ok: true, resume: state ? resumeAt(progressOf(state)) : { at: "consent" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
