"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
import {
  AFTERWARDS,
  MOMENT_ATTENTION,
  MOMENT_PLACES,
  SURVEY_VERSION,
  type Afterwards,
  type MomentAttention,
  type MomentPlace,
  type SurveyMoment,
} from "@voicemural/shared";
import { Chips, Field, MultiChips, SaveState, Scale } from "./fields";
import { useSurveyDocument } from "./use-survey-document";

/**
 * The form: a list of moments, each asked about in the same depth, then three
 * questions about the whole.
 *
 * ## The wording lives here
 *
 * `@voicemural/shared/survey` owns the KEYS and the allowed values; this file
 * owns every sentence a person reads. Reword freely, and bump
 * `SURVEY_VERSION` there when the meaning moves.
 *
 * ## How it saves
 *
 * The whole document, a second after the last edit, and loaded back on the
 * next visit: `useSurveyDocument`, which the end-of-week form shares.
 *
 * ## Nothing is required
 *
 * Every field is optional and every moment can be deleted. The one thing the
 * page insists on is that Send is only offered once there is at least one
 * moment, because a survey about moments with none in it is a survey that was
 * opened by mistake.
 */

export function SurveyForm() {
  const { answers, status, submittedAt, update, send } = useSurveyDocument("initial", SURVEY_VERSION);

  const updateMoment = useCallback(
    (id: string, patch: Partial<SurveyMoment>) =>
      update((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    [update],
  );

  const addMoment = () =>
    update((prev) => ({
      ...prev,
      moments: [...prev.moments, { id: crypto.randomUUID() }],
    }));

  const removeMoment = (id: string) =>
    update((prev) => ({ ...prev, moments: prev.moments.filter((m) => m.id !== id) }));

  if (status === "loading") {
    return <p className="text-sm text-fg/60">Loading what you saved…</p>;
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="moments">
        <h2 id="moments" className="mb-1 text-sm font-medium tracking-wide text-fg/60 uppercase">
          The moments
        </h2>
        <p className="mb-4 text-sm text-fg/60">
          One card per time you used it. Start with the one you remember best.
        </p>

        <ol className="space-y-4">
          {answers.moments.map((moment, i) => (
            <li key={moment.id}>
              <MomentCard
                n={i + 1}
                moment={moment}
                onChange={(patch) => updateMoment(moment.id, patch)}
                onRemove={() => removeMoment(moment.id)}
              />
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={addMoment}
          className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg/90 hover:border-fg/30 hover:text-fg"
        >
          <Plus size={15} aria-hidden />
          {answers.moments.length === 0 ? "Add the first moment" : "Add another moment"}
        </button>
      </section>

      <section aria-labelledby="overall" className="space-y-5">
        <h2 id="overall" className="text-sm font-medium tracking-wide text-fg/60 uppercase">
          Overall
        </h2>
        <Field
          label="If you told a friend what this thing is, what would you say?"
          value={answers.describe ?? ""}
          onChange={(describe) => update((p) => ({ ...p, describe }))}
        />
        <Field
          label="What would make you pick it up again tomorrow?"
          value={answers.again ?? ""}
          onChange={(again) => update((p) => ({ ...p, again }))}
        />
        <Field
          label="Anything else?"
          value={answers.anythingElse ?? ""}
          onChange={(anythingElse) => update((p) => ({ ...p, anythingElse }))}
        />
      </section>

      <footer className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={send}
          disabled={answers.moments.length === 0 || status === "saving"}
          className="cursor-pointer rounded-full bg-fg/12 px-5 py-2.5 text-sm font-medium text-fg ring-1 ring-fg/25 hover:bg-fg/20 disabled:cursor-default disabled:opacity-40"
        >
          {submittedAt ? "Send again" : "Send"}
        </button>
        <SaveState status={status} submittedAt={submittedAt} />
      </footer>
    </div>
  );
}

/** One moment, asked about in depth. */
function MomentCard({
  n,
  moment,
  onChange,
  onRemove,
}: {
  n: number;
  moment: SurveyMoment;
  onChange: (patch: Partial<SurveyMoment>) => void;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface/40 p-5">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-3 text-base font-medium">
          <span className="font-mono text-xs text-fg/45 tabular-nums" aria-hidden>
            {n}
          </span>
          {moment.when?.trim() ? moment.when : "A moment"}
        </h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove moment ${n}`}
          className="cursor-pointer rounded p-1 text-fg/45 hover:text-fg/70"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </header>

      <div className="space-y-5">
        <Field
          label="When was it?"
          hint="Roughly: “Tuesday morning, on the way in”, “last night after dinner”."
          value={moment.when ?? ""}
          onChange={(when) => onChange({ when })}
          rows={1}
        />

        <Chips<MomentPlace>
          label="Where were you?"
          options={MOMENT_PLACES}
          labels={PLACE_LABELS}
          value={moment.where}
          onPick={(where) => onChange({ where })}
        />
        {moment.where === "other" && (
          <Field
            label="Where, then?"
            value={moment.whereOther ?? ""}
            onChange={(whereOther) => onChange({ whereOther })}
            rows={1}
          />
        )}

        <Chips<MomentAttention>
          label="How much of you was on it?"
          options={MOMENT_ATTENTION}
          labels={ATTENTION_LABELS}
          value={moment.attention}
          onPick={(attention) => onChange({ attention })}
        />

        <Field
          label="What was on your mind? What were you trying to work out?"
          value={moment.onMind ?? ""}
          onChange={(onMind) => onChange({ onMind })}
        />
        <Field
          label="What did you say to it, roughly?"
          value={moment.said ?? ""}
          onChange={(said) => onChange({ said })}
        />
        <Field
          label="What did it say or do back?"
          value={moment.itDid ?? ""}
          onChange={(itDid) => onChange({ itDid })}
        />

        <Scale
          label="Did that help?"
          low="Not at all"
          high="A lot"
          value={moment.helped ?? null}
          onPick={(helped) => onChange({ helped })}
        />
        <Field
          label="How, or why not?"
          value={moment.helpedWhy ?? ""}
          onChange={(helpedWhy) => onChange({ helpedWhy })}
        />
        <Field
          label="Was there something you wanted it to do that it didn't?"
          value={moment.wanted ?? ""}
          onChange={(wanted) => onChange({ wanted })}
        />

        <MultiChips<Afterwards>
          label="Did you look at anything afterwards?"
          options={AFTERWARDS}
          labels={AFTERWARDS_LABELS}
          value={moment.afterwards ?? []}
          onChange={(afterwards) => onChange({ afterwards })}
        />
      </div>
    </article>
  );
}

const PLACE_LABELS: Record<MomentPlace, string> = {
  driving: "Driving",
  walking: "Walking",
  public_transport: "On a bus or train",
  at_home: "At home",
  at_a_desk: "At a desk",
  other: "Somewhere else",
};

const ATTENTION_LABELS: Record<MomentAttention, string> = {
  hands_and_eyes_busy: "Hands and eyes busy",
  hands_busy: "Hands busy, could glance",
  fully_on_it: "Fully on it",
};

const AFTERWARDS_LABELS: Record<Afterwards, string> = {
  board: "The board",
  draft: "A draft",
  transcript: "The transcript",
  nothing: "Nothing",
};
