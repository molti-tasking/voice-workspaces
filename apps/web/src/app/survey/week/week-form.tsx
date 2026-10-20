"use client";

import {
  KEEP_WAYS,
  WEEK_PREFERENCES,
  WEEK_SURVEY_VERSION,
  weekAnswered,
  type KeepWay,
  type WeekAnswers,
  type WeekItem,
  type WeekPreference,
} from "@voicemural/shared";
import { Chips, Field, SaveState, Scale } from "../fields";
import { useSurveyDocument } from "../use-survey-document";

/**
 * The end-of-week questionnaire: how was it to choose?
 *
 * `@voicemural/shared/survey` owns the keys, the scales and which items are
 * reversed; this file owns every sentence a person reads. Reword freely, and
 * bump `WEEK_SURVEY_VERSION` there when the meaning moves.
 *
 * In the order the week is remembered: choosing first, then one thing kept
 * and one let go, then the questions Souffleur asked, then the whole. Every
 * rating is "not at all true" to "very true", so a thumb learns the row once.
 */

type Rated = { item: WeekItem; label: string };

const CHOOSING: Rated[] = [
  { item: "choice_own", label: "On the days I chose, what I kept felt like my own decision." },
  { item: "choice_had_to", label: "I kept things because I felt I was supposed to." },
  { item: "choice_enjoy", label: "I enjoyed deciding what to keep." },
  { item: "choice_effort", label: "Deciding what to keep took attention I didn't have to spare." },
  { item: "kept_value", label: "Keeping things in my own head was worth doing." },
  { item: "held_trust", label: "I trusted Souffleur to hold what I didn't keep." },
];

const QUESTIONS: Rated[] = [
  { item: "sparks_suggested_useful", label: "On the days Souffleur picked, its questions were useful." },
  { item: "sparks_chosen_useful", label: "On the days I picked, its questions were useful." },
];

const KEEP_WAY_LABELS: Record<KeepWay, string> = {
  tap: "By tapping Keep",
  voice: "By saying “keep this one”",
  both: "Both",
  neither: "I didn't keep anything",
};

const PREFERENCE_LABELS: Record<WeekPreference, string> = {
  souffleur_picks: "Souffleur picks",
  i_pick: "I pick",
  no_difference: "No difference",
  unsure: "Not sure",
};

const INTERVIEW_LABELS: Record<"yes" | "no", string> = { yes: "Yes", no: "No" };

const SECTION = "text-sm font-medium tracking-wide text-fg/60 uppercase";

export function WeekForm() {
  const { answers, status, submittedAt, update, send } = useSurveyDocument("week", WEEK_SURVEY_VERSION);

  const set = <F extends keyof WeekAnswers>(field: F) => (value: WeekAnswers[F]) =>
    update((prev) => ({ ...prev, [field]: value }));
  const rate = (item: WeekItem) => (value: number) =>
    update((prev) => ({ ...prev, ratings: { ...prev.ratings, [item]: value } }));
  const scale = ({ item, label }: Rated) => (
    <Scale
      key={item}
      label={label}
      low="Not at all true"
      high="Very true"
      value={answers.ratings?.[item] ?? null}
      onPick={rate(item)}
    />
  );

  if (status === "loading") {
    return <p className="text-sm text-fg/60">Loading what you saved…</p>;
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="choosing" className="space-y-5">
        <h2 id="choosing" className={SECTION}>
          Choosing
        </h2>
        {CHOOSING.map(scale)}
        <Field
          label="How did it feel to choose what to keep, and to let the rest go?"
          value={answers.chooseFeel ?? ""}
          onChange={set("chooseFeel")}
        />
      </section>

      <section aria-labelledby="incidents" className="space-y-5">
        <h2 id="incidents" className={SECTION}>
          One you kept, one you let go
        </h2>
        <Field
          label="Think of one subject you kept. What was it about, roughly, and why that one?"
          value={answers.keptIncident ?? ""}
          onChange={set("keptIncident")}
        />
        <Field
          label="And one you let Souffleur hold. Why that one?"
          value={answers.heldIncident ?? ""}
          onChange={set("heldIncident")}
        />
        <Field
          label="Did anything you kept come back to you later in the week? When, and how?"
          value={answers.keptAfter ?? ""}
          onChange={set("keptAfter")}
        />
        <Chips<KeepWay>
          label="How did you mostly keep things?"
          options={KEEP_WAYS}
          labels={KEEP_WAY_LABELS}
          value={answers.keepHow}
          onPick={set("keepHow")}
        />
        <Field
          label="What made you keep that way?"
          value={answers.keepHowWhy ?? ""}
          onChange={set("keepHowWhy")}
          rows={2}
        />
      </section>

      <section aria-labelledby="questions" className="space-y-5">
        <h2 id="questions" className={SECTION}>
          Souffleur&apos;s questions
        </h2>
        {QUESTIONS.map(scale)}
        <Field
          label="Was there a question that stuck with you, or one that missed? What happened?"
          value={answers.sparkIncident ?? ""}
          onChange={set("sparkIncident")}
        />
      </section>

      <section aria-labelledby="overall" className="space-y-5">
        <h2 id="overall" className={SECTION}>
          Overall
        </h2>
        <Chips<WeekPreference>
          label="If it stayed one way from now on, which would you want?"
          options={WEEK_PREFERENCES}
          labels={PREFERENCE_LABELS}
          value={answers.preferred}
          onPick={set("preferred")}
        />
        <Field label="Why?" value={answers.preferredWhy ?? ""} onChange={set("preferredWhy")} rows={2} />
        <Field
          label="What would you change about keeping?"
          value={answers.change ?? ""}
          onChange={set("change")}
        />
        <Chips<"yes" | "no">
          label="Would you join a short conversation (about 30 minutes) about your week?"
          options={["yes", "no"]}
          labels={INTERVIEW_LABELS}
          value={answers.interview}
          onPick={set("interview")}
        />
        <Field label="Anything else?" value={answers.anythingElse ?? ""} onChange={set("anythingElse")} />
      </section>

      <footer className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={send}
          disabled={!weekAnswered(answers) || status === "saving"}
          className="cursor-pointer rounded-full bg-fg/12 px-5 py-2.5 text-sm font-medium text-fg ring-1 ring-fg/25 hover:bg-fg/20 disabled:cursor-default disabled:opacity-40"
        >
          {submittedAt ? "Send again" : "Send"}
        </button>
        <SaveState status={status} submittedAt={submittedAt} />
      </footer>
    </div>
  );
}
