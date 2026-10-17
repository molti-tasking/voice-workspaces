/**
 * Speech cues: what one turn of theirs says about how sure they were.
 *
 * The recorder's sparks (apps/web/src/lib/talkback/signals.ts) show, per
 * subject, how much the person hesitated over it — and hesitation is only
 * partly in the timing. The pauses come from the container, which has the
 * VAD; the rest is in the words, and the words are already on the phone.
 * These count them.
 *
 * SHARED WITH THE WORKER. `isSelfRepair` was the worker's (steerability.ts),
 * where the study's self-repair rate is computed. It moved here so the
 * recorder's live count and the exported metric are one implementation; the
 * worker re-exports it, and its numbers are unchanged.
 *
 * GERMAN AND ENGLISH, lexical and coarse, for the same reasons as the
 * worker's classifiers: the corpus is mixed, and under-counting is the safe
 * direction. A hesitation signal biased towards finding less of it cannot
 * tell somebody they sounded unsure when they did not.
 *
 * COUNTS ONLY. Nothing here keeps or returns a phrase; the subject signal that
 * leaves the phone (`subject_signal`) is numbers.
 */

/** Lower-cased, punctuation-stripped, single-spaced. German umlauts kept. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`´„“”…—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Somebody correcting THEMSELVES, mid-thought.
 *
 * "No, wait — the other way round." "Beziehungsweise, eigentlich eher…" This
 * is the audible form of a thought being revised while it is being formed, and
 * it is the single best evidence in the transcript that the person is still
 * doing the thinking rather than dictating a conclusion they had already
 * reached. The self-explanation literature calls the same thing
 * error-correction, and it is the mechanism that makes explaining to yourself
 * work at all.
 *
 * WHY IT MATTERS HERE. The failure this study is exposed to is a system that
 * captures beautifully while the thinking quietly moves into it — better
 * artefacts, less self-correction, nothing learned. A self-repair rate that
 * falls over a week, while everything else improves, is what that looks like
 * from the outside.
 *
 * MID-UTTERANCE ON PURPOSE, which is the opposite of `isCorrection`. A repair
 * of your own sentence happens inside it, after the thing being repaired; a
 * rejection of what the agent said opens the reply. The two share a couple of
 * phrases, and `metrics.ts` separates them by whether an agent turn came
 * first — the addressee is a fact about the turn structure, not about the
 * words.
 */
const SELF_REPAIR_PATTERNS: readonly RegExp[] = [
  // German. `beziehungsweise` and `also eher` are almost purely repair
  // markers; `beziehungsweise` has no innocent reading at all.
  /\bbeziehungsweise\b/,
  /\bbzw\b/,
  /\b(also|oder|nein) (eher|besser|vielmehr)\b/,
  /\bquatsch\b/,
  /\bmoment (mal)?\b.{0,20}\b(nein|nicht|doch)\b/,
  /\bich meine\b/,
  /\bkorrektur\b/,
  /\bnein (warte|halt|doch)\b/,
  // English
  /\bno wait\b/,
  /\bwait no\b/,
  /\bor rather\b/,
  /\bi mean\b/,
  /\bscratch that\b/,
  /\blet me rephrase\b/,
  /\bactually,? no\b/,
  /\bwhat i mean is\b/,
];

export function isSelfRepair(text: string): boolean {
  const said = normalise(text);
  if (!said) return false;
  return SELF_REPAIR_PATTERNS.some((pattern) => pattern.test(said));
}

/** How many self-repairs one turn holds: every marker, counted once each. */
export function countSelfRepairs(text: string): number {
  return countMatches(normalise(text), SELF_REPAIR_PATTERNS);
}

/**
 * Hedges: the words people put in front of a claim they are not sure of.
 *
 * Matched anywhere, but each phrase only as a phrase — "I think" and "ich
 * glaube", never "think" or "glaube" on their own, which are just as often
 * the verb of a sentence that is perfectly sure of itself.
 */
const HEDGE_PATTERNS: readonly RegExp[] = [
  // German
  /\bvielleicht\b/g,
  /\bich glaube\b/g,
  /\bich denke\b/g,
  /\bwahrscheinlich\b/g,
  /\bvermutlich\b/g,
  /\bkeine ahnung\b/g,
  /\bweiß (ich )?nicht\b/g,
  /\bweiss (ich )?nicht\b/g,
  /\b(nicht |un)sicher\b/g,
  /\bkönnte sein\b/g,
  /\birgendwie\b/g,
  // English
  /\bmaybe\b/g,
  /\bperhaps\b/g,
  /\bprobably\b/g,
  /\bi think\b/g,
  /\bi guess\b/g,
  /\bi suppose\b/g,
  /\bnot sure\b/g,
  /\bi don t know\b/g,
  /\bmight be\b/g,
];

/** How many hedges one turn holds. */
export function countHedges(text: string): number {
  return countMatches(normalise(text), HEDGE_PATTERNS);
}

/**
 * Fillers: "um", "uh", "äh", "ähm".
 *
 * Zero on most drives, and that is correct: speech-to-text drops them unless
 * asked to keep them (Deepgram's `filler_words`), and Whisper never keeps
 * them. When they do arrive, the recorder counts them here and leaves them
 * out of the text it shows (`stripFillers`).
 */
const FILLER = /(?<![\p{L}\p{N}])(?:u+m+|u+h+|h+m+|e+r+m+|ä+h+m*|ö+h+m*|e+h+m+)(?![\p{L}\p{N}])/giu;

/** How many fillers one turn holds. */
export function countFillers(text: string): number {
  return text.match(FILLER)?.length ?? 0;
}

/** The turn without its fillers, for the screen. The model still hears them. */
export function stripFillers(text: string): string {
  return text
    .replace(new RegExp(`${FILLER.source}[,.…]?`, FILLER.flags), "")
    .replace(/\s+([,.!?…])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.…]+/, "")
    .trim();
}

/** The cues of one turn, as the subject signal adds them up. */
export interface TurnCues {
  fillers: number;
  selfRepairs: number;
  hedges: number;
}

export function turnCues(text: string): TurnCues {
  return {
    fillers: countFillers(text),
    selfRepairs: countSelfRepairs(text),
    hedges: countHedges(text),
  };
}

function countMatches(said: string, patterns: readonly RegExp[]): number {
  if (!said) return 0;
  let count = 0;
  for (const pattern of patterns) {
    const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
    count += said.match(global)?.length ?? 0;
  }
  return count;
}
