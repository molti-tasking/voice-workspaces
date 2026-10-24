"use client";

import { useState } from "react";
import {
  BLOCK_RATINGS,
  BlockAnswers,
  GAME_QUESTIONS,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  type BlockRatingKey,
  type GameQuestionKey,
} from "@voicemural/shared";
import { ErrorLine, PrimaryButton, Scale, StudyFrame } from "../../p/ui";

/**
 * After the conversation, with it gone from the screen: what they worked out,
 * in their own words, first — before any question could cue it — then where
 * they had got to before the game and how they found their way back, then the
 * ratings, then anything that helped or got in the way. Sent once, at the
 * end, so half an answer never lands.
 *
 * The question about before the game used to come straight after it, before
 * the conversation was back; asked there, it had them recall where they were
 * just before the resumption it is meant to leave alone.
 */
export function PostBlock({
  eyebrow,
  hadGame,
  onSubmit,
}: {
  eyebrow: string;
  /** The game interrupted this conversation: ask about it, and how picking it up again went. */
  hadGame: boolean;
  /** False when it did not save. */
  onSubmit: (answers: BlockAnswers) => Promise<boolean>;
}) {
  const [summary, setSummary] = useState("");
  const [game, setGame] = useState<Record<GameQuestionKey, string>>({ beforeGame: "", wayBack: "" });
  const [ratings, setRatings] = useState<Partial<Record<BlockRatingKey, number>>>({});
  const [helped, setHelped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asked = BLOCK_RATINGS.filter((r) => hadGame || !("afterGame" in r));
  const answers = BlockAnswers.safeParse({
    summary,
    // Required when there was a game: an empty one does not parse.
    ...(hadGame ? game : {}),
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

      {hadGame &&
        (Object.keys(GAME_QUESTIONS) as GameQuestionKey[]).map((key) => (
          <label key={key} className="block space-y-2">
            <span className="block font-medium">{GAME_QUESTIONS[key].question}</span>
            <span className="block text-sm text-fg/60">{GAME_QUESTIONS[key].hint}</span>
            <textarea
              value={game[key]}
              onChange={(e) => setGame((now) => ({ ...now, [key]: e.target.value }))}
              rows={3}
              maxLength={2000}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base leading-relaxed"
            />
          </label>
        ))}

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
