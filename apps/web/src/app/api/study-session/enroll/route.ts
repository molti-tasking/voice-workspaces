import { NextResponse } from "next/server";
import { claimSession, findSessionByUser, progressOf, startProlificSession } from "@voicemural/db/study-session";
import { SessionEnroll, resumeAt } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";
import { blockView, completionCodeRequired } from "@/lib/study/session-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consent given on a session's page: the session becomes this account's. The
 * page makes a guest first, so an account always exists here.
 *
 * - With an invite's code: that session (`claimSession`).
 * - From Prolific: theirs by their Prolific ID, made now in the active setup
 *   if they have none (`startProlificSession`). The answer carries its block,
 *   which the page could not know before.
 *
 * Answers where to pick up, which is the start for a new participant and
 * their place for one who reloaded.
 *
 * 404 `unknown`: no session has this code. 409 `not_a_guest`, `other_session`
 * or `claimed_elsewhere`: the page says what to do (a private window, or the
 * other browser). 503 `closed`: no setup is running, or — in production — it
 * has no completion code to pay with.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = SessionEnroll.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  // Off by default: a real account's drives reach its workspace, memory and
  // the field study's export. A researcher trying the session as themself
  // switches it on knowingly.
  const allowAccounts = process.env.STUDY_SESSION_ALLOW_ACCOUNTS === "true";

  if ("prolific" in parsed.data) {
    const result = await startProlificSession({
      ...parsed.data.prolific,
      userId,
      allowAccounts,
      requireCode: completionCodeRequired(),
    });
    if (!result.ok) {
      const status = result.reason === "unknown" ? 404 : result.reason === "closed" ? 503 : 409;
      return NextResponse.json({ error: result.reason }, { status, headers });
    }
    return NextResponse.json(
      { ok: true, resume: resumeAt(progressOf(result.state)), block: blockView(result.state.blocks[0]!) },
      { headers },
    );
  }

  const result = await claimSession({ code: parsed.data.code, userId, allowAccounts });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "unknown" ? 404 : 409, headers });
  }

  const state = await findSessionByUser(userId);
  return NextResponse.json({ ok: true, resume: state ? resumeAt(progressOf(state)) : { at: "consent" } }, { headers });
}
