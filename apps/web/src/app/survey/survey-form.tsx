"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AFTERWARDS,
  MOMENT_ATTENTION,
  MOMENT_PLACES,
  SURVEY_VERSION,
  emptySurveyAnswers,
  type Afterwards,
  type MomentAttention,
  type MomentPlace,
  type SurveyAnswers,
  type SurveyMoment,
  type SurveyResponseView,
} from "@voicemural/shared";

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
 * The whole document, every time, a second after the last edit — not per
 * field, and not on a button, because a form on a phone is left mid-sentence
 * when the bus arrives. Send does the same write with `submit: true`. A saved
 * draft loads back on the next visit, from the server rather than from
 * localStorage, so the phone and the laptop see the same half-finished
 * answers.
 *
 * ## Nothing is required
 *
 * Every field is optional and every moment can be deleted. The one thing the
 * page insists on is that Send is only offered once there is at least one
 * moment, because a survey about moments with none in it is a survey that was
 * opened by mistake.
 */

const SURVEY = "initial" as const;
const SAVE_AFTER_MS = 1000;

type Status = "loading" | "idle" | "saving" | "saved" | "sent" | "error";

export function SurveyForm() {
  const [answers, setAnswers] = useState<SurveyAnswers>(emptySurveyAnswers);
  const [status, setStatus] = useState<Status>("loading");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  // The edit that is waiting to be saved, so a save never runs on the render
  // it was scheduled in, and Send saves what is on screen rather than what
  // the last timer saw.
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/survey?survey=${SURVEY}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const view = (await res.json()) as SurveyResponseView | null;
        if (cancelled) return;
        if (view) {
          setAnswers(view.answers);
          setSubmittedAt(view.submittedAt);
        }
        setStatus(view?.submittedAt ? "sent" : "idle");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (next: SurveyAnswers, submit: boolean) => {
      setStatus("saving");
      try {
        const res = await fetch("/api/survey", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ survey: SURVEY, version: SURVEY_VERSION, answers: next, submit }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { submittedAt: string | null };
        dirty.current = false;
        setSubmittedAt(body.submittedAt);
        setStatus(body.submittedAt ? "sent" : "saved");
      } catch {
        setStatus("error");
      }
    },
    [],
  );

  const update = useCallback(
    (patch: (prev: SurveyAnswers) => SurveyAnswers) => {
      setAnswers((prev) => {
        const next = patch(prev);
        dirty.current = true;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save(next, false), SAVE_AFTER_MS);
        return next;
      });
    },
    [save],
  );

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

  const send = () => {
    if (timer.current) window.clearTimeout(timer.current);
    void save(answers, true);
  };

  if (status === "loading") {
    return <p className="text-sm text-white/40">Loading what you saved…</p>;
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="moments">
        <h2 id="moments" className="mb-1 text-sm font-medium tracking-wide text-white/40 uppercase">
          The moments
        </h2>
        <p className="mb-4 text-sm text-white/40">
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
          className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-ink-soft px-4 py-2.5 text-sm font-medium text-white/90 hover:border-white/30 hover:text-white"
        >
          <Plus size={15} aria-hidden />
          {answers.moments.length === 0 ? "Add the first moment" : "Add another moment"}
        </button>
      </section>

      <section aria-labelledby="overall" className="space-y-5">
        <h2 id="overall" className="text-sm font-medium tracking-wide text-white/40 uppercase">
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
          className="cursor-pointer rounded-full bg-white/12 px-5 py-2.5 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/20 disabled:cursor-default disabled:opacity-40"
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
    <article className="rounded-xl border border-line bg-ink-soft/40 p-5">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-3 text-base font-medium">
          <span className="font-mono text-xs text-white/25 tabular-nums" aria-hidden>
            {n}
          </span>
          {moment.when?.trim() ? moment.when : "A moment"}
        </h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove moment ${n}`}
          className="cursor-pointer rounded p-1 text-white/25 hover:text-white/70"
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

/* --- The pieces ---------------------------------------------------------- */

function Field({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-white/70">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-white/35">{hint}</span>}
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-lg border border-line bg-black/20 px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
      />
    </label>
  );
}

const CHIP = "cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors";
const CHIP_ON = "bg-white/12 text-white ring-1 ring-white/25";
const CHIP_OFF = "text-white/40 hover:text-white/70 ring-1 ring-white/10";

function Chips<T extends string>({
  label,
  options,
  labels,
  value,
  onPick,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-white/70">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            onClick={() => onPick(option)}
            className={[CHIP, option === value ? CHIP_ON : CHIP_OFF].join(" ")}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function MultiChips<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (value: T[]) => void;
}) {
  const toggle = (option: T) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-white/70">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option)}
              className={[CHIP, on ? CHIP_ON : CHIP_OFF].join(" ")}
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One 1–7 item as a row of targets, the same shape the recorder's ratings use. */
function Scale({
  label,
  low,
  high,
  value,
  onPick,
}: {
  label: string;
  low: string;
  high: string;
  value: number | null;
  onPick: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-white/70">{label}</legend>
      <div className="flex gap-1.5">
        {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={n === value}
            onClick={() => onPick(n)}
            className={[
              "grid size-10 cursor-pointer place-items-center rounded-lg text-sm tabular-nums transition-colors",
              n === value ? CHIP_ON : "text-white/40 ring-1 ring-white/10 hover:text-white/70",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-white/30">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

function SaveState({ status, submittedAt }: { status: Status; submittedAt: string | null }) {
  if (status === "error") {
    return <p className="text-sm text-red-300">Could not save. Check the connection and try again.</p>;
  }
  if (status === "saving") return <p className="text-sm text-white/40">Saving…</p>;
  if (status === "sent" && submittedAt) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-200">
        <Check size={14} aria-hidden />
        Sent. Thank you — you can still change anything and send again.
      </p>
    );
  }
  if (status === "saved") return <p className="text-sm text-white/40">Saved.</p>;
  return null;
}
