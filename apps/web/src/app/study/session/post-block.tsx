"use client";

import { useState } from "react";
import {
  BLOCK_RATINGS,
  BlockAnswers,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  type BlockRatingKey,
} from "@voicemural/shared";
import { ErrorLine, PrimaryButton, Scale, StudyFrame } from "../../p/ui";

/**
 * After each conversation, with the conversation gone from the screen: what
 * they worked out, in their own words, first — before any question could cue
 * it — then the ratings, then anything that helped or got in the way. Sent
 * once, at the end, so half an answer never lands.
 */
export function PostBlock({
  eyebrow,
  hadGame,
  onSubmit,
}: {
  eyebrow: string;
  /** The game interrupted this conversation: ask how picking it up again went. */
  hadGame: boolean;
  /** False when it did not save. */
  onSubmit: (answers: BlockAnswers) => Promise<boolean>;
}) {
  const [summary, setSummary] = useState("");
  const [ratings, setRatings] = useState<Partial<Record<BlockRatingKey, number>>>({});
  const [helped, setHelped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asked = BLOCK_RATINGS.filter((r) => hadGame || !("afterGame" in r));
  const answers = BlockAnswers.safeParse({
    summary,
    ...ratings,
    ...(helped.trim() ? { helped } : {}),
  });
  const complete = answers.success && asked.every((r) => ratings[r.key] !== undefined);

  async function submit() {
    if (!answers.success || !complete) return;
    setBusy(true);
    setError(null);
    const ok = await onSubmit(answers.data);
    setBusy(false);
    if (!ok) setError("That did not save. Please check your connection and try again.");
  }

  const length = summary.trim().length;
  return (
    <StudyFrame eyebrow={eyebrow} title="About that conversation">
      <label className="block space-y-2">
        <span className="block font-medium">In two or three sentences: what did you work out, and what is still open?</span>
        <span className="block text-sm text-fg/60">From memory, in your own words. There are no wrong answers.</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          maxLength={SUMMARY_MAX_CHARS}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base leading-relaxed"
        />
        {length > 0 && length < SUMMARY_MIN_CHARS && (
          <span className="block text-sm text-fg/55">A little more, please.</span>
        )}
      </label>

      {asked.map((r) => (
        <Scale
          key={r.key}
          question={r.question}
          low={r.low}
          high={r.high}
          value={ratings[r.key] ?? null}
          disabled={busy}
          onPick={(v) => setRatings((now) => ({ ...now, [r.key]: v }))}
        />
      ))}

      <label className="block space-y-2">
        <span className="block font-medium">Was there anything on the screen that helped, or got in the way?</span>
        <span className="block text-sm text-fg/60">Optional.</span>
        <textarea
          value={helped}
          onChange={(e) => setHelped(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base leading-relaxed"
        />
      </label>

      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!complete || busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Continue"}
      </PrimaryButton>
    </StudyFrame>
  );
}
