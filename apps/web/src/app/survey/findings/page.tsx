import type { Metadata } from "next";
import { FindingsForm } from "./findings-form";
import { INTRO } from "./wording";

/**
 * The findings survey: four early findings, and what the people who drove
 * make of them.
 *
 * PUBLIC, unlike `/survey`. That one keeps answers with the account that
 * recorded the drives; this one promised anonymity, so it asks nobody to sign
 * in and records nobody. The answers land in `anonymous_survey_response` and
 * are read at `/survey/findings/results`, which is for the researcher only.
 */

export const metadata: Metadata = {
  // The root layout's template appends " — Souffleur".
  title: "Four findings",
  // Sent to the people it is for, not found.
  robots: { index: false, follow: false },
};

export default function FindingsSurveyPage() {
  return (
    <div className="mx-auto max-w-2xl vm-page-top px-6 pb-40">
      <header className="mb-10">
        <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">{INTRO.eyebrow}</p>
        <h1 className="text-2xl font-semibold">{INTRO.title}</h1>
        <p className="mt-2 leading-relaxed text-fg/60">{INTRO.body}</p>
      </header>
      <FindingsForm />
    </div>
  );
}
