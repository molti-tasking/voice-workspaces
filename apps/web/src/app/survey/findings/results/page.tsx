import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { anonymousSurveyResponse, asc, eq, getDb } from "@voicemural/db";
import { FINDINGS_SURVEY, FindingsAnswers } from "@voicemural/shared";
import { currentUser } from "@/lib/session";
import { isResearcher } from "@/lib/study/researchers";
import type { FindingsResponse } from "../summary";
import { FindingsDashboard } from "./findings-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // The root layout's template appends " — Souffleur".
  title: "Survey results",
  robots: { index: false, follow: false },
};

/**
 * The findings survey's answers, for the researcher.
 *
 * A 404 for everyone else, signed in or not, rather than a "not allowed":
 * nothing about this page should confirm it exists. Who counts as the
 * researcher is `RESEARCHER_USER_IDS` (see `@/lib/study/researchers`).
 *
 * Read whole on every request. A survey sent to a handful of people is a
 * handful of rows; the dashboard asks again every 20 seconds while open.
 */
export default async function FindingsResultsPage() {
  const user = await currentUser();
  if (!isResearcher(user?.id)) notFound();

  const rows = await getDb()
    .select({
      id: anonymousSurveyResponse.id,
      submittedOn: anonymousSurveyResponse.submittedOn,
      answers: anonymousSurveyResponse.answers,
    })
    .from(anonymousSurveyResponse)
    .where(eq(anonymousSurveyResponse.survey, FINDINGS_SURVEY))
    .orderBy(asc(anonymousSurveyResponse.submittedOn), asc(anonymousSurveyResponse.id));

  // Re-validated on the way out, as `/api/survey` does: a document written
  // against an older shape is left out rather than crashing the page.
  const responses: FindingsResponse[] = rows.flatMap((row) => {
    const answers = FindingsAnswers.safeParse(row.answers);
    return answers.success ? [{ id: row.id, submittedOn: row.submittedOn, answers: answers.data }] : [];
  });

  return <FindingsDashboard responses={responses} loadedAt={new Date().toISOString()} />;
}
