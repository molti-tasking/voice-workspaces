import { NextResponse } from "next/server";
import { and, eq, getDb, surveyResponse } from "@voicemural/db";
import { SurveyAnswers, SurveyKey, SurveyResponseUpsert, type SurveyResponseView } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * One person's answers to one survey, read back and written whole.
 *
 * WHOLE, every time. The form on `/survey` holds the document and saves it as
 * one piece — a draft on blur, the final on Send — so there is nothing to
 * merge and no order two saves could arrive in that leaves the row half of
 * each. The unique index on (user, survey) makes the write an upsert.
 *
 * NOT `study_response`. That route takes an integer per item and nothing
 * else, by construction, so its table can be exported untouched. This takes
 * sentences. See the table comment in the schema for what that changes.
 */

function surveyKey(req: Request): SurveyKey | null {
  const raw = new URL(req.url).searchParams.get("survey");
  const parsed = SurveyKey.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** What was last saved for this survey, or `null` when nothing was. */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const survey = surveyKey(req);
  if (!survey) return NextResponse.json({ error: "unknown_survey" }, { status: 400 });

  const rows = await getDb()
    .select({
      version: surveyResponse.version,
      answers: surveyResponse.answers,
      submittedAt: surveyResponse.submittedAt,
      updatedAt: surveyResponse.updatedAt,
    })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.userId, userId), eq(surveyResponse.survey, survey)))
    .limit(1);

  const row = rows[0];
  if (!row) return NextResponse.json(null, { headers: { "Cache-Control": "no-store" } });

  // Re-validated on the way out: a document written by an older page against
  // a shape this one no longer understands renders as far as it parses,
  // rather than crashing the form on a field nobody can see.
  const answers = SurveyAnswers.safeParse(row.answers);
  const view: SurveyResponseView = {
    version: row.version,
    answers: answers.success ? answers.data : { moments: [] },
    submittedAt: row.submittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

/** Save the document. `submit: true` also marks it sent. */
export async function PUT(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = SurveyResponseUpsert.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { survey, version, answers, submit } = parsed.data;
  const now = new Date();

  // A sent survey stays sent: a later draft-save from the same page must not
  // quietly un-submit it, so `submittedAt` is only ever set, never cleared.
  const [row] = await getDb()
    .insert(surveyResponse)
    .values({
      userId,
      survey,
      version,
      answers,
      submittedAt: submit ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [surveyResponse.userId, surveyResponse.survey],
      set: {
        version,
        answers,
        updatedAt: now,
        ...(submit ? { submittedAt: now } : {}),
      },
    })
    .returning({ submittedAt: surveyResponse.submittedAt, updatedAt: surveyResponse.updatedAt });

  return NextResponse.json(
    {
      ok: true,
      submittedAt: row?.submittedAt?.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? now.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
