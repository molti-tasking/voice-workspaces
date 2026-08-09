"use client";

import posthog from "posthog-js";

/**
 * Survey plumbing for custom-rendered (`API`-type) surveys.
 *
 * PostHog can render surveys itself, but not here. `/record` is a phone in a
 * cradle in a moving car, and a popover that PostHog decides to show mid-drive
 * is a safety problem rather than an annoyance. Rendering them ourselves is
 * what makes "never while recording" enforceable.
 *
 * Set the survey's type to `API` in PostHog. That is a real in-app type which
 * passes eligibility but is never auto-rendered by posthog-js — which is
 * exactly what we want. Do *not* reach for `disable_surveys: true` instead; it
 * would also switch off `getActiveMatchingSurveys` and there would be nothing
 * to render.
 */

// Derived from posthog-js's own callback signature rather than redeclared, so
// a shape change upstream is a compile error here instead of a silent mismatch.
type SurveyCallback = Parameters<typeof posthog.getActiveMatchingSurveys>[0];
export type Survey = Parameters<SurveyCallback>[0][number];
export type SurveyQuestion = Survey["questions"][number];

/** Where a survey is allowed to appear, and what it can be told about. */
export interface SurveyContext {
  /** Hard block: never interrupt someone who is recording while driving. */
  isRecording: boolean;
  pathname: string;
  /** The extraction being reviewed, when the page is showing one. */
  extractionId?: string;
  sessionsCount?: number;
}

/**
 * PostHog's own suppression keys.
 *
 * posthog-js writes these when it renders a survey itself. Custom rendering
 * bypasses that, so unless we write them too, `seenSurveyWaitPeriodInDays` and
 * per-survey seen-suppression quietly stop working and the settings in the
 * PostHog UI become decorative.
 */
const SEEN_PREFIX = "seenSurvey_";
const LAST_SEEN_KEY = "lastSeenSurveyDate";

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private browsing */
  }
}

export function hasSeenSurvey(surveyId: string): boolean {
  return readLocal(`${SEEN_PREFIX}${surveyId}`) === "true";
}

function markSurveySeen(surveyId: string): void {
  writeLocal(`${SEEN_PREFIX}${surveyId}`, "true");
  writeLocal(LAST_SEEN_KEY, new Date().toISOString());
}

/**
 * Whether it is acceptable to put a survey on screen right now.
 *
 * These are local guards on top of PostHog's targeting, not a substitute for
 * it. PostHog decides *who* should be asked; this decides whether *this moment*
 * is a reasonable one.
 */
export function canShowSurvey(context: SurveyContext): boolean {
  // Never mid-drive. This is the guard the whole custom-rendering approach
  // exists for.
  if (context.isRecording) return false;

  // `/record` is only ever acceptable after a recording has been saved, which
  // the caller signals by not being in the recording state on that route. The
  // page also sets `user-select: none` for glanceable use in a car, so an
  // open-text question there would be unanswerable anyway.
  if (context.pathname.startsWith("/record")) return false;

  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;

  // Offline, the response would sit in an in-memory queue that a tab eviction
  // discards. Better to ask again later than to burn the one impression the
  // wait period allows on an answer that never arrives.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  return true;
}

/**
 * Ask PostHog which surveys match, once flags have loaded.
 *
 * `getActiveMatchingSurveys` re-checks feature flags as part of matching, so
 * calling it before `/flags` has returned silently yields nothing. That is a
 * real risk here rather than a theoretical one: the most useful trigger is
 * right after a drive, on a phone that may still be recovering signal.
 */
export function onMatchingSurveys(callback: (surveys: Survey[]) => void): () => void {
  let cancelled = false;

  posthog.onFeatureFlags(() => {
    if (cancelled) return;
    posthog.getActiveMatchingSurveys((surveys) => {
      if (!cancelled) callback(surveys);
    });
  });

  return () => {
    cancelled = true;
  };
}

function baseProperties(survey: Survey, context: SurveyContext): Record<string, unknown> {
  return {
    $survey_id: survey.id,
    $survey_name: survey.name,
    // Without this a response is a number with nothing attached. `extraction_id`
    // is the same value as the corresponding generation's `$ai_trace_id`, so an
    // answer can be read against the exact model output being judged.
    ...(context.extractionId ? { extraction_id: context.extractionId } : {}),
    ...(context.sessionsCount !== undefined ? { sessions_count: context.sessionsCount } : {}),
  };
}

export function reportSurveyShown(survey: Survey, context: SurveyContext): void {
  markSurveySeen(survey.id);
  posthog.capture("survey shown", baseProperties(survey, context));
}

export function reportSurveyDismissed(survey: Survey, context: SurveyContext): void {
  posthog.capture("survey dismissed", baseProperties(survey, context));
}

/**
 * Submit answers.
 *
 * Keyed `$survey_response_<questionId>` using the question's UUID. The
 * index-based form (`$survey_response`, `$survey_response_1`) is legacy, and
 * mixing the two makes responses impossible to join to their question after a
 * survey is edited.
 */
export function reportSurveySent(
  survey: Survey,
  responsesByQuestionId: Record<string, string>,
  context: SurveyContext,
): void {
  const responses: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(responsesByQuestionId)) {
    responses[`$survey_response_${questionId}`] = answer;
  }

  posthog.capture("survey sent", {
    ...baseProperties(survey, context),
    ...responses,
    $survey_questions: survey.questions.map((q) => q.question),
    $survey_completed: true,
  });

  // Also record on the person, so "has not answered recently" is expressible as
  // a live property in survey targeting rather than a lagging cohort.
  posthog.setPersonProperties({
    last_survey_at: new Date().toISOString(),
  });
}
