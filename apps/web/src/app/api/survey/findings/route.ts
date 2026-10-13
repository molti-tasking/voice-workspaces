import { NextResponse } from "next/server";
import { anonymousSurveyResponse, getDb } from "@voicemural/db";
import { FINDINGS_SURVEY, FindingsSubmission, hasAnyAnswer } from "@voicemural/shared";

export const runtime = "nodejs";

/**
 * The findings survey's answers, from anyone with the link.
 *
 * NO SESSION, ON PURPOSE. The invitation says the answers are anonymous, so
 * this route never asks who is sending: there is no `currentUserId` here and
 * no column to put one in. What it keeps is the document and the day.
 *
 * WHOLE, every time, keyed by an id the browser made. Sending again from the
 * same browser replaces the document, so a correction is not a second
 * respondent. A different browser is a different respondent; with a handful
 * of colleagues invited by name, that is an acceptable edge.
 *
 * Small defences, because the URL is public: a body-size cap, the schema's
 * own length caps, an empty document refused, and a honeypot field that gets
 * the same `ok` a person gets so a bot learns nothing from the answer.
 */

/** Far above a fully answered form; far below anything worth storing. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const parsed = FindingsSubmission.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { id, version, answers, website } = parsed.data;

  if (website?.trim()) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!hasAnyAnswer(answers)) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  const submittedOn = new Date().toISOString().slice(0, 10);
  await getDb()
    .insert(anonymousSurveyResponse)
    .values({ id, survey: FINDINGS_SURVEY, version, answers, submittedOn })
    .onConflictDoUpdate({
      target: anonymousSurveyResponse.id,
      set: { version, answers, submittedOn },
    });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
