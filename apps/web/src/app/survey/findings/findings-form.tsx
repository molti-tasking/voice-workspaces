"use client";

import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  ARRIVALS,
  FINDINGS_VERSION,
  FindingsAnswers,
  HAND_OFF_ANSWERS,
  HAND_OFF_TASKS,
  KEEP_USING,
  NOT_APPLICABLE,
  USAGE_LEVELS,
  USE_REASONS,
  WRAP_UPS,
  hasAnyAnswer,
  type HandOffAnswer,
  type HandOffTask,
} from "@voicemural/shared";
import { readLocalValue, useLocalValue, writeLocalValue } from "@/lib/local-value";
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Field, MultiChips, Scale } from "../fields";
import * as W from "./wording";

/**
 * The findings survey's form.
 *
 * ## Anonymous, and kept that way on this side too
 *
 * No session is read and none is sent. The whole form sits inside
 * `ph-no-capture`, which keeps PostHog's autocapture from recording which
 * option was tapped and blanks the form out of session replay — either would
 * tie an answer to a person, and the invitation says nothing does.
 *
 * ## How it saves
 *
 * The draft lives in this browser's storage as it is typed — storage is the
 * form's state, read through `useLocalValue` — so a phone that reloads
 * mid-form keeps it. Send posts the whole document with an id this browser
 * made; sending again replaces it rather than adding a respondent. Storage
 * can be missing (private windows) — then the form forgets on reload, and
 * still sends.
 */

const STORAGE = {
  id: "souffleur.findings.id",
  draft: "souffleur.findings.draft",
  sent: "souffleur.findings.sent",
} as const;

type Status = "idle" | "sending" | "sent" | "error" | "empty";

/** The saved draft, or an empty form if there is none or it no longer parses. */
function parseDraft(raw: string | null): FindingsAnswers {
  if (!raw) return {};
  try {
    const parsed = FindingsAnswers.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Blank text and empty selections are not answers; drop them before sending. */
function clean(answers: FindingsAnswers): FindingsAnswers {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      if (value.trim()) out[key] = value.trim();
    } else if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value;
    } else if (typeof value === "object" && value !== null) {
      if (Object.keys(value).length > 0) out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out as FindingsAnswers;
}

export function FindingsForm() {
  const draft = useLocalValue(STORAGE.draft);
  const answers = useMemo(() => parseDraft(draft), [draft]);
  const sentBefore = useLocalValue(STORAGE.sent) !== null;
  const [status, setStatus] = useState<Status>("idle");
  // The honeypot. Hidden from people and from screen readers; a bot fills it.
  const [website, setWebsite] = useState("");

  const update = useCallback(
    (patch: Partial<FindingsAnswers>) => {
      writeLocalValue(STORAGE.draft, JSON.stringify({ ...answers, ...patch }));
      setStatus((s) => (s === "empty" || s === "error" ? "idle" : s));
    },
    [answers],
  );

  const pickHandOff = (task: HandOffTask, answer: HandOffAnswer) =>
    update({ handOff: { ...answers.handOff, [task]: answer } });

  const send = async () => {
    const cleaned = clean(answers);
    if (!hasAnyAnswer(cleaned)) {
      setStatus("empty");
      return;
    }
    let id = readLocalValue(STORAGE.id);
    if (!id) {
      id = crypto.randomUUID();
      writeLocalValue(STORAGE.id, id);
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/survey/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, version: FINDINGS_VERSION, answers: cleaned, website }),
      });
      if (!res.ok) throw new Error(String(res.status));
      writeLocalValue(STORAGE.sent, "1");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  const reasons = answers.useReasons ?? [];

  return (
    <div className="ph-no-capture space-y-12">
      <section aria-label="About you">
        <Chips
          label={W.USAGE_QUESTION}
          options={USAGE_LEVELS}
          labels={W.USAGE_LABELS}
          value={answers.usage}
          onPick={(usage) => update({ usage })}
        />
      </section>

      <FindingSection finding={W.FINDINGS[0]}>
        <div className="space-y-3">
          <Scale
            label={W.SILENCE_MATCH.question}
            low={W.SILENCE_MATCH.low}
            high={W.SILENCE_MATCH.high}
            points={5}
            value={typeof answers.silenceMatch === "number" ? answers.silenceMatch : null}
            onPick={(silenceMatch) => update({ silenceMatch })}
          />
          <button
            type="button"
            aria-pressed={answers.silenceMatch === NOT_APPLICABLE}
            onClick={() => update({ silenceMatch: NOT_APPLICABLE })}
            className={[CHIP, answers.silenceMatch === NOT_APPLICABLE ? CHIP_ON : CHIP_OFF].join(" ")}
          >
            {W.SILENCE_MATCH.notApplicable}
          </button>
        </div>
        <Field
          label={W.SILENCE_WANTED}
          value={answers.silenceWanted ?? ""}
          onChange={(silenceWanted) => update({ silenceWanted })}
        />
      </FindingSection>

      <FindingSection finding={W.FINDINGS[1]}>
        <MultiChips
          label={`${W.USE_REASONS_QUESTION} ${W.USE_REASONS_HINT}`}
          options={USE_REASONS}
          labels={W.USE_REASON_LABELS}
          value={reasons}
          onChange={(useReasons) => update({ useReasons })}
        />
        {reasons.includes("other") && (
          <Field
            label={W.USE_REASON_OTHER}
            rows={2}
            value={answers.useReasonOther ?? ""}
            onChange={(useReasonOther) => update({ useReasonOther })}
          />
        )}
        <Field label={W.LEARNED} value={answers.learned ?? ""} onChange={(learned) => update({ learned })} />
      </FindingSection>

      <FindingSection finding={W.FINDINGS[2]}>
        <Chips
          label={W.ARRIVAL_QUESTION}
          options={ARRIVALS}
          labels={W.ARRIVAL_LABELS}
          value={answers.arrival}
          onPick={(arrival) => update({ arrival })}
        />
        {answers.arrival === "other" && (
          <Field
            label={W.ARRIVAL_OTHER}
            rows={2}
            value={answers.arrivalOther ?? ""}
            onChange={(arrivalOther) => update({ arrivalOther })}
          />
        )}
        <Chips
          label={W.WRAP_UP_QUESTION}
          options={WRAP_UPS}
          labels={W.WRAP_UP_LABELS}
          value={answers.wrapUp}
          onPick={(wrapUp) => update({ wrapUp })}
        />
        <Field
          label={W.WRAP_UP_WHY}
          rows={2}
          value={answers.wrapUpWhy ?? ""}
          onChange={(wrapUpWhy) => update({ wrapUpWhy })}
        />
      </FindingSection>

      <FindingSection finding={W.FINDINGS[3]}>
        <fieldset>
          <legend className="mb-3 text-sm text-fg/70">{W.HAND_OFF_QUESTION}</legend>
          <ul className="space-y-5">
            {HAND_OFF_TASKS.map((task) => (
              <li key={task}>
                <p id={`hand-off-${task}`} className="mb-2 text-sm text-fg">
                  {W.HAND_OFF_TASK_LABELS[task]}
                </p>
                <div role="group" aria-labelledby={`hand-off-${task}`} className="flex flex-wrap gap-1.5">
                  {HAND_OFF_ANSWERS.map((answer) => {
                    const on = answers.handOff?.[task] === answer;
                    return (
                      <button
                        key={answer}
                        type="button"
                        aria-pressed={on}
                        onClick={() => pickHandOff(task, answer)}
                        className={[CHIP, on ? CHIP_ON : CHIP_OFF].join(" ")}
                      >
                        {W.HAND_OFF_ANSWER_LABELS[answer]}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field label={W.NEVER_DO} value={answers.neverDo ?? ""} onChange={(neverDo) => update({ neverDo })} />
      </FindingSection>

      <section aria-labelledby="overall" className="space-y-6">
        <h2 id="overall" className="text-sm font-medium tracking-wide text-fg/60 uppercase">
          {W.OVERALL_TITLE}
        </h2>
        <Scale
          label={W.UMUX_CAPABILITIES.question}
          low={W.UMUX_CAPABILITIES.low}
          high={W.UMUX_CAPABILITIES.high}
          value={answers.umuxCapabilities ?? null}
          onPick={(umuxCapabilities) => update({ umuxCapabilities })}
        />
        <Scale
          label={W.UMUX_EASE.question}
          low={W.UMUX_EASE.low}
          high={W.UMUX_EASE.high}
          value={answers.umuxEase ?? null}
          onPick={(umuxEase) => update({ umuxEase })}
        />
        <Chips
          label={W.KEEP_USING_QUESTION}
          options={KEEP_USING}
          labels={W.KEEP_USING_LABELS}
          value={answers.keepUsing}
          onPick={(keepUsing) => update({ keepUsing })}
        />
        <Field
          label={W.WORKSHOP_QUESTION}
          value={answers.workshopQuestion ?? ""}
          onChange={(workshopQuestion) => update({ workshopQuestion })}
        />
      </section>

      {/* Off-screen rather than display:none, which some bots skip. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <footer className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void send()}
          disabled={status === "sending"}
          className="cursor-pointer rounded-full bg-fg/12 px-5 py-2.5 text-sm font-medium text-fg ring-1 ring-fg/25 hover:bg-fg/20 disabled:cursor-default disabled:opacity-40"
        >
          {sentBefore ? "Send again" : "Send"}
        </button>
        <SendState status={status} sentBefore={sentBefore} />
      </footer>
    </div>
  );
}

function FindingSection({ finding, children }: { finding: W.Finding; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`finding-${finding.n}`} className="space-y-6">
      <header className="rounded-xl border border-line bg-surface/40 p-5">
        <p className="mb-1 font-mono text-xs text-fg/45">Finding {finding.n}</p>
        <h2 id={`finding-${finding.n}`} className="text-base font-medium">
          {finding.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg/70">{finding.statement}</p>
      </header>
      {children}
    </section>
  );
}

function SendState({ status, sentBefore }: { status: Status; sentBefore: boolean }) {
  if (status === "sending") return <p className="text-sm text-fg/60">Sending…</p>;
  if (status === "error") {
    return <p className="text-sm text-red-300">Could not send. Check the connection and try again.</p>;
  }
  if (status === "empty") return <p className="text-sm text-fg/60">Answer at least one question first.</p>;
  if (status === "sent" || sentBefore) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-200">
        <Check size={14} aria-hidden />
        Sent. Thank you — you can still change anything and send again.
      </p>
    );
  }
  return null;
}
