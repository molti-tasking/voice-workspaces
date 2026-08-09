"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  canShowSurvey,
  hasSeenSurvey,
  onMatchingSurveys,
  reportSurveyDismissed,
  reportSurveySent,
  reportSurveyShown,
  type Survey,
  type SurveyContext,
} from "@/lib/analytics/surveys";

/**
 * Renders one eligible survey, in the app's own styling.
 *
 * Mounted at a *trigger moment* rather than globally, so a survey appears at a
 * point where the question makes sense. The best of those is `/workspace` with
 * a `?since=` diff on screen: the participant is looking at exactly what the
 * model extracted from their own speech, and `extractionId` ties the answer to
 * the generation that produced it.
 */
export function SurveyHost({
  extractionId,
  sessionsCount,
  isRecording = false,
}: {
  extractionId?: string;
  sessionsCount?: number;
  /** Passed from the recorder. A survey must never appear during a drive. */
  isRecording?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const context: SurveyContext = {
    isRecording,
    pathname,
    extractionId,
    sessionsCount,
  };

  useEffect(() => {
    if (!canShowSurvey(context)) return;

    return onMatchingSurveys((surveys) => {
      // PostHog's own seen-suppression, which custom rendering has to apply by
      // hand — the SDK only writes those keys when it renders a survey itself.
      const next = surveys.find((s) => !hasSeenSurvey(s.id));
      if (next) setSurvey(next);
    });
    // Re-evaluated per route: each trigger moment is its own opportunity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isRecording, extractionId]);

  useEffect(() => {
    if (survey) reportSurveyShown(survey, context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey?.id]);

  const dismiss = useCallback(() => {
    if (survey) reportSurveyDismissed(survey, context);
    setSurvey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey]);

  if (!survey) return null;

  // A recording that starts while the card is open closes it. The guard above
  // only covers the moment it appears.
  if (isRecording) return null;

  const submit = () => {
    reportSurveySent(survey, answers, context);
    setSubmitted(true);
    setTimeout(() => setSurvey(null), 1600);
  };

  const allAnswered = survey.questions.every((q, i) => answers[questionId(survey, i)]);

  return (
    // `bottom-24` clears the timeline's fixed pill bar, which sits at z-20.
    <div className="fixed right-4 bottom-24 z-30 w-[min(22rem,calc(100vw-2rem))]">
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-4 shadow-2xl shadow-black/40">
        {submitted ? (
          <p className="text-sm text-emerald-300">Thank you — that helps.</p>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-3">
              <p className="min-w-0 flex-1 text-sm leading-snug font-medium">
                {survey.questions[0]?.question}
              </p>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 text-white/30 hover:text-white/70"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {survey.questions.map((question, index) => (
                <QuestionField
                  key={questionId(survey, index)}
                  question={question}
                  // The first question is already the card's heading.
                  showLabel={index > 0}
                  value={answers[questionId(survey, index)] ?? ""}
                  onChange={(value) =>
                    setAnswers((prev) => ({ ...prev, [questionId(survey, index)]: value }))
                  }
                />
              ))}
            </div>

            <button
              type="button"
              disabled={!allAnswered}
              onClick={submit}
              className="mt-4 w-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The question's UUID, which is what `$survey_response_<id>` must be keyed on.
 *
 * Falling back to the index keeps a survey authored before PostHog added
 * per-question ids answerable, rather than dropping its responses on the floor.
 */
function questionId(survey: Survey, index: number): string {
  const question = survey.questions[index] as { id?: string } | undefined;
  return question?.id ?? String(index);
}

function QuestionField({
  question,
  value,
  onChange,
  showLabel,
}: {
  question: Survey["questions"][number];
  value: string;
  onChange: (value: string) => void;
  showLabel: boolean;
}) {
  const label = showLabel ? (
    <p className="mb-2 text-sm leading-snug">{question.question}</p>
  ) : null;

  if (question.type === "rating") {
    const scale = question.scale ?? 5;
    return (
      <div>
        {label}
        <div className="flex gap-1.5">
          {Array.from({ length: scale }, (_, i) => String(i + 1)).map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => onChange(score)}
              className={[
                "h-9 flex-1 rounded-lg border text-sm transition-colors",
                value === score
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white"
                  : "border-[var(--color-line)] text-white/50 hover:text-white/80",
              ].join(" ")}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "single_choice" || question.type === "multiple_choice") {
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-1.5">
          {(question.choices ?? []).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => onChange(choice)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                value === choice
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white"
                  : "border-[var(--color-line)] text-white/50 hover:text-white/80",
              ].join(" ")}
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] p-2 text-sm text-white/90 outline-none focus:border-white/30"
      />
    </div>
  );
}
