"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * One subject at a time, in five steps: rate, recall, look, rate again, say
 * whose idea it was. Each rating is posted as it is tapped, and the first
 * step must land before the drive's words are fetched — the server enforces
 * that order too.
 *
 * The recall box is a scratchpad: it is never sent, and it is emptied for the
 * next subject.
 */

interface Probe {
  id: string;
  title: string;
  driveStartedAt: string;
  /** Confidence already given on an earlier visit: it goes straight to the reveal. */
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
  { value: "souffleur", label: "Souffleur's" },
  { value: "both", label: "Both" },
  { value: "unsure", label: "Not sure" },
];

async function post(id: string, body: object): Promise<{ ok?: boolean; lines?: Line[] } | null> {
  const res = await fetch(`/api/recall/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as { ok?: boolean; lines?: Line[] }) : null;
}

export function RecallFlow({ probes }: { probes: Probe[] }) {
  const [index, setIndex] = useState(0);
  const probe = probes[index];
  if (!probe) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <p className="font-medium text-emerald-100">That is all of them. Thank you.</p>
        <Link href="/" className="mt-2 inline-block text-sm text-fg/70 underline">
          Back
        </Link>
      </div>
    );
  }
  return (
    <ProbeSteps
      // Keyed, so the next subject starts from its first step with an empty box.
      key={probe.id}
      probe={probe}
      position={`${index + 1} of ${probes.length}`}
      onDone={() => setIndex((i) => i + 1)}
    />
  );
}

function ProbeSteps({
  probe,
  position,
  onDone,
}: {
  probe: Probe;
  position: string;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scratch, setScratch] = useState("");

  const when = new Date(probe.driveStartedAt).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  async function rateConfidence(value: number | null) {
    setBusy(true);
    setError(null);
    const answer = await post(
      probe.id,
      value === null ? { step: "reveal" } : { step: "confidence", confidence: value },
    );
    setBusy(false);
    if (!answer) return setError("That did not save. Try again.");
    setLines(answer.lines ?? []);
  }

  async function finish(provenance: Provenance) {
    if (accuracy === null) return;
    setBusy(true);
    setError(null);
    const answer = await post(probe.id, { step: "answer", selfAccuracy: accuracy, provenance });
    setBusy(false);
    if (!answer) return setError("That did not save. Try again.");
    onDone();
  }

  return (
    <section className="ph-no-capture space-y-6" aria-label={probe.title}>
      <div>
        <p className="text-xs tracking-wide text-fg/50 uppercase">
          {position} · {when}
        </p>
        <h2 className="mt-1 text-xl font-semibold">{probe.title}</h2>
      </div>

      {lines === null && !probe.rated && (
        <Scale
          question="How well do you remember where you landed on this?"
          low="Not at all"
          high="Exactly"
          disabled={busy}
          onPick={(v) => void rateConfidence(v)}
        />
      )}
      {lines === null && probe.rated && (
        // Rated on an earlier visit, before they left: the rating stands, and
        // this only fetches the reveal again.
        <button
          type="button"
          disabled={busy}
          onClick={() => void rateConfidence(null)}
          className="rounded-xl bg-fg/10 px-4 py-3 text-sm font-medium"
        >
          Show what you said
        </button>
      )}

      {lines === null && (
        <label className="block">
          <span className="mb-1 block text-sm text-fg/70">
            Say it to yourself, or type it here. This box is never saved or sent.
          </span>
          <textarea
            value={scratch}
            onChange={(e) => setScratch(e.target.value)}
            rows={3}
            autoComplete="off"
            className="w-full rounded-xl border border-line bg-surface p-3 text-base"
          />
        </label>
      )}

      {lines !== null && (
        <>
          <div className="rounded-2xl border border-line bg-surface/70 p-4">
            <p className="mb-2 text-xs font-medium tracking-wide text-fg/50 uppercase">
              What was said
            </p>
            {lines.length === 0 ? (
              <p className="text-sm text-fg/60">Nothing of it was transcribed.</p>
            ) : (
              <ol className="space-y-2">
                {lines.map((line, i) => (
                  <li
                    key={i}
                    className={[
                      "border-l-2 pl-2.5 text-[0.95rem] leading-snug",
                      line.who === "agent" ? "border-sky-400/60 text-fg/70" : "border-fg/25",
                    ].join(" ")}
                  >
                    <span className="mr-1.5 text-xs text-fg/45">
                      {line.who === "agent" ? "Souffleur" : "You"}
                    </span>
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
            disabled={busy}
            value={accuracy}
            onPick={setAccuracy}
          />

          {accuracy !== null && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Whose idea was this mostly?</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROVENANCE.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={busy}
                    onClick={() => void finish(p.value)}
                    className="min-h-11 rounded-xl bg-fg/10 px-3 text-sm font-medium hover:bg-fg/15 disabled:opacity-40"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      {error && <p className="text-sm text-amber-300">{error}</p>}
    </section>
  );
}

function Scale({
  question,
  low,
  high,
  disabled,
  value = null,
  onPick,
}: {
  question: string;
  low: string;
  high: string;
  disabled: boolean;
  value?: number | null;
  onPick: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{question}</legend>
      <div className="grid grid-cols-7 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={value === n}
            onClick={() => onPick(n)}
            className={[
              "min-h-11 rounded-xl text-base font-medium disabled:opacity-40",
              value === n ? "bg-fg text-canvas" : "bg-fg/10 hover:bg-fg/15",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg/50">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}
