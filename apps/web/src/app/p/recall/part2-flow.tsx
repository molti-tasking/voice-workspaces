"use client";

import { useEffect, useState } from "react";
import { FREE_RECALL_MAX_CHARS, FREE_RECALL_MIN_CHARS, type ProlificClosing } from "@voicemural/shared";
import { Completion, ErrorLine, PrimaryButton, Scale, StudyFrame } from "../ui";

/**
 * Part 2, in the browser: introduction → free recall → one card per recall
 * probe → closing questions → the completion code.
 *
 * THE ORDER IS THE MEASURE. The free recall comes first, with nothing on
 * screen that names a subject; only then are the subjects shown one by one,
 * each rated before their own words come back. The server refuses any other
 * order (`/api/prolific/part2`), so a reload cannot reorder it either.
 */

interface Probe {
  id: string;
  title: string;
  /** Rated on an earlier visit: straight to the reveal. */
  rated: boolean;
}

interface Line {
  who: "user" | "agent";
  offsetMs: number;
  text: string;
}

type Provenance = "mine" | "souffleur" | "both" | "unsure";

const PROVENANCE: { value: Provenance; label: string }[] = [
  { value: "mine", label: "Mine" },
  { value: "souffleur", label: "The assistant's" },
  { value: "both", label: "Both" },
  { value: "unsure", label: "Not sure" },
];

type Step = "intro" | "free" | "probes" | "closing" | "done";

async function post<T>(body: object): Promise<T | null> {
  const res = await fetch("/api/prolific/part2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json().catch(() => null)) as T | null) ?? null;
}

export function Part2Flow({
  pid,
  studyId,
  sessionId,
  sparks,
  taskTitle,
  freeRecallDone,
  probes,
}: {
  pid: string;
  studyId?: string;
  sessionId?: string;
  sparks: boolean;
  taskTitle: string;
  freeRecallDone: boolean;
  probes: Probe[];
}) {
  const [step, setStep] = useState<Step>(freeRecallDone ? (probes.length > 0 ? "probes" : "closing") : "intro");
  const [completion, setCompletion] = useState<{ url: string | null; code: string | null } | null>(null);

  // The first visit, with Prolific's ids for part 2. Fire and forget.
  useEffect(() => {
    void post({ step: "begin", pid, studyId, sessionId });
  }, [pid, studyId, sessionId]);

  switch (step) {
    case "intro":
      return (
        <StudyFrame eyebrow="Part 2 of 2" title="What do you remember?">
          <p>
            In part 1 you talked with a voice assistant about <strong>{taskTitle.toLowerCase()}</strong>. This
            part asks what you remember of that conversation. It takes about 10 minutes.
          </p>
          <p>
            Please answer from memory only: do not look anything up, and do not use notes or other tools. It is
            completely fine not to remember much; that is useful to us too.
          </p>
          <PrimaryButton onClick={() => setStep("free")}>Begin</PrimaryButton>
        </StudyFrame>
      );
    case "free":
      return <FreeRecall pid={pid} onDone={() => setStep(probes.length > 0 ? "probes" : "closing")} />;
    case "probes":
      return <Probes pid={pid} probes={probes} onDone={() => setStep("closing")} />;
    case "closing":
      return (
        <Closing
          pid={pid}
          sparks={sparks}
          onDone={(result) => {
            setCompletion(result);
            setStep("done");
          }}
        />
      );
    case "done":
      return <Completion part={2} url={completion?.url ?? null} code={completion?.code ?? null} />;
  }
}

/* ------------------------------------------------------------------------- */

function FreeRecall({ pid, onDone }: { pid: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const long = text.trim().length >= FREE_RECALL_MIN_CHARS;

  async function submit() {
    if (!long || confidence === null) return;
    setBusy(true);
    setError(null);
    const ok = await post<{ ok: boolean }>({ step: "free_recall", pid, text: text.trim(), confidence });
    setBusy(false);
    if (!ok) return setError("That did not save. Please try again.");
    onDone();
  }

  return (
    <StudyFrame eyebrow="Part 2 of 2" title="Write down everything you remember">
      <p>
        Write down everything you remember from the conversation: the ideas, suggestions, reasons and decisions —
        both yours and the assistant&apos;s. Short notes or bullet points are fine. Take your time.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        maxLength={FREE_RECALL_MAX_CHARS}
        autoComplete="off"
        spellCheck
        // No pasting: what they write must come from memory, not a clipboard.
        onPaste={(e) => e.preventDefault()}
        className="w-full rounded-xl border border-line bg-surface p-3 text-base"
        aria-label="Everything you remember"
      />
      <p className="text-xs text-fg/55">
        {long ? `${text.trim().length} characters` : `Please write at least ${FREE_RECALL_MIN_CHARS} characters.`}
      </p>
      {long && (
        <Scale
          question="How much of the conversation do you think you have written down?"
          low="Very little of it"
          high="Nearly all of it"
          value={confidence}
          disabled={busy}
          onPick={setConfidence}
        />
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
      <p className="text-sm text-fg/60">Once you continue, you cannot change this text.</p>
      <PrimaryButton disabled={!long || confidence === null || busy} onClick={() => void submit()}>
        Continue
      </PrimaryButton>
    </StudyFrame>
  );
}

/* ------------------------------------------------------------------------- */

function Probes({ pid, probes, onDone }: { pid: string; probes: Probe[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const probe = probes[index];
  useEffect(() => {
    if (!probe) onDone();
  }, [probe, onDone]);
  if (!probe) return null;
  return (
    <ProbeCard
      key={probe.id}
      pid={pid}
      probe={probe}
      position={`${index + 1} of ${probes.length}`}
      onDone={() => setIndex((i) => i + 1)}
    />
  );
}

function ProbeCard({
  pid,
  probe,
  position,
  onDone,
}: {
  pid: string;
  probe: Probe;
  position: string;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal(confidence: number | null) {
    setBusy(true);
    setError(null);
    const answer = await post<{ lines?: Line[] }>(
      confidence === null
        ? { step: "probe_reveal", pid, probeId: probe.id }
        : { step: "probe_confidence", pid, probeId: probe.id, confidence },
    );
    setBusy(false);
    if (!answer) return setError("That did not save. Please try again.");
    setLines(answer.lines ?? []);
  }

  async function finish(provenance: Provenance) {
    if (accuracy === null) return;
    setBusy(true);
    setError(null);
    const answer = await post<{ ok: boolean }>({
      step: "probe_answer",
      pid,
      probeId: probe.id,
      selfAccuracy: accuracy,
      provenance,
    });
    setBusy(false);
    if (!answer) return setError("That did not save. Please try again.");
    onDone();
  }

  return (
    <StudyFrame eyebrow={`Part 2 of 2 · topic ${position}`} title={probe.title}>
      <p className="text-fg/70">One of the topics of your conversation, as the assistant named it.</p>

      {lines === null && !probe.rated && (
        <>
          <p>Think back: what did you conclude about this topic?</p>
          <Scale
            question="How well do you remember where you ended up on this?"
            low="Not at all"
            high="Exactly"
            value={null}
            disabled={busy}
            onPick={(v) => void reveal(v)}
          />
        </>
      )}
      {lines === null && probe.rated && (
        <PrimaryButton disabled={busy} onClick={() => void reveal(null)}>
          Show what was said
        </PrimaryButton>
      )}

      {lines !== null && (
        <>
          <div className="rounded-2xl border border-line bg-surface/70 p-4">
            <p className="mb-2 text-xs font-medium tracking-wide text-fg/55 uppercase">What was said</p>
            {lines.length === 0 ? (
              <p className="text-sm text-fg/60">Nothing of it was transcribed.</p>
            ) : (
              <ol className="max-h-80 space-y-2 overflow-y-auto">
                {lines.map((line, i) => (
                  <li
                    key={i}
                    className={[
                      "border-l-2 pl-2.5 text-[0.95rem] leading-snug",
                      line.who === "agent" ? "border-sky-400/60 text-fg/70" : "border-fg/25",
                    ].join(" ")}
                  >
                    <span className="mr-1.5 text-xs text-fg/50">{line.who === "agent" ? "Assistant" : "You"}</span>
                    {line.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <Scale
            question="How close was what you remembered?"
            low="Not at all"
            high="Exactly"
            value={accuracy}
            disabled={busy}
            onPick={setAccuracy}
          />
          {accuracy !== null && (
            <fieldset>
              <legend className="mb-2 font-medium">Whose idea was this mostly?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROVENANCE.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={busy}
                    onClick={() => void finish(p.value)}
                    className="min-h-11 cursor-pointer rounded-xl bg-fg/10 px-3 text-sm font-medium hover:bg-fg/15 disabled:opacity-40"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </StudyFrame>
  );
}

/* ------------------------------------------------------------------------- */

function Closing({
  pid,
  sparks,
  onDone,
}: {
  pid: string;
  sparks: boolean;
  onDone: (completion: { url: string | null; code: string | null }) => void;
}) {
  const [tookAway, setTookAway] = useState<number | null>(null);
  const [ownIdeas, setOwnIdeas] = useState<number | null>(null);
  const [assistantThought, setAssistantThought] = useState<number | null>(null);
  const [cardsHelped, setCardsHelped] = useState<number | null>(null);
  const [rehearsed, setRehearsed] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    tookAway !== null &&
    ownIdeas !== null &&
    assistantThought !== null &&
    (!sparks || cardsHelped !== null) &&
    rehearsed !== null;

  async function submit() {
    if (!complete) return;
    const answers: ProlificClosing = {
      tookAway,
      ownIdeas,
      assistantThought,
      cardsHelped: sparks ? cardsHelped : null,
      rehearsed,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    setBusy(true);
    setError(null);
    const result = await post<{ completionUrl?: string | null; completionCode?: string | null }>({
      step: "closing",
      pid,
      answers,
    });
    setBusy(false);
    if (!result) return setError("That did not save. Please try again.");
    onDone({ url: result.completionUrl ?? null, code: result.completionCode ?? null });
  }

  return (
    <StudyFrame eyebrow="Part 2 of 2" title="A few last questions">
      <Scale
        question="How much did you take away from yesterday's conversation?"
        low="Nothing"
        high="A great deal"
        value={tookAway}
        onPick={setTookAway}
      />
      <Scale
        question="The ideas from the conversation feel like my own."
        low="Disagree"
        high="Agree"
        value={ownIdeas}
        onPick={setOwnIdeas}
      />
      <Scale
        question="The assistant did most of the thinking."
        low="Disagree"
        high="Agree"
        value={assistantThought}
        onPick={setAssistantThought}
      />
      {sparks && (
        <Scale
          question="The question cards helped me think the problem through."
          low="Disagree"
          high="Agree"
          value={cardsHelped}
          onPick={setCardsHelped}
        />
      )}
      <fieldset>
        <legend className="mb-2 font-medium">
          Since part 1, did you write anything down about the conversation, look the topic up, or talk it over with
          someone?
        </legend>
        <p className="mb-2 text-sm text-fg/60">Please answer honestly; it does not affect your payment.</p>
        <div className="flex gap-2">
          {[
            { value: true, label: "Yes" },
            { value: false, label: "No" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={rehearsed === o.value}
              onClick={() => setRehearsed(o.value)}
              className={[
                "min-h-11 cursor-pointer rounded-xl px-6 text-base font-medium",
                rehearsed === o.value ? "bg-fg text-canvas" : "bg-fg/10 hover:bg-fg/15",
              ].join(" ")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1 block font-medium">Anything else you would like to tell us? (optional)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-xl border border-line bg-surface p-3 text-base"
        />
      </label>
      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!complete || busy} onClick={() => void submit()}>
        Finish the study
      </PrimaryButton>
    </StudyFrame>
  );
}
