/**
 * Repairing Whisper's repetition loops.
 *
 * Whisper degenerates on quiet, unclear or truncated audio: instead of
 * returning little, it locks onto a phrase and repeats it, sometimes for
 * hundreds of words. A real chunk from this deployment:
 *
 *   "Right before that you'd also asked whether you could talk through all the
 *    previous work you'd done, but the Transc. is the first of its kind, and the
 *    Transc. is the first of its kind, and the Transc. is the first of its kind,
 *    and …"                                            (~30 more repetitions)
 *
 * This matters more here than in most systems, for two reasons.
 *
 * It corrupts the LEDGER — the append-only verbatim record the entire design
 * rests on — with hundreds of words the driver never said. And because
 * `transcribe-chunk.ts` feeds the previous chunk's tail to Whisper as a
 * continuity prompt, a looping chunk seeds the next one with its own loop, so
 * the failure sustains itself for the rest of the drive. Three consecutive
 * chunks in the observed session were pure loop.
 *
 * Repaired at the ASR boundary rather than at any one call site, because this
 * is a property of the model rather than of a caller: the live conversation path
 * loops the same way, and would otherwise answer a question the driver never
 * asked.
 *
 * What is NOT done here: the repaired text is a transcription of what was said,
 * not a rewrite of it. Only exact repeated runs collapse. A driver who genuinely
 * says something twice keeps both.
 */

/**
 * How many consecutive repeats before it is treated as degenerate.
 *
 * Three, not two. People repeat themselves — "no, no, no", a restated
 * sentence — and the ledger is meant to hold that. Nothing legitimate says the
 * same phrase three times in immediate succession with no variation.
 */
const MIN_REPEATS = 3;

/** Longest repeating unit to look for, in words. Beyond this it is not a loop. */
const MAX_PERIOD = 24;

function isRun(words: string[], start: number, period: number, repeats: number): boolean {
  for (let r = 1; r < repeats; r++) {
    for (let i = 0; i < period; i++) {
      if (words[start + i] !== words[start + r * period + i]) return false;
    }
  }
  return true;
}

/**
 * Collapse immediately repeated phrases to a single occurrence.
 *
 * Shortest period first: the loop unit is usually short, and finding the
 * smallest one avoids collapsing two adjacent repeats of a long phrase into
 * something that reads oddly.
 */
export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_REPEATS * 2) return text;

  const out: string[] = [];
  let i = 0;

  while (i < words.length) {
    let collapsed = false;

    const longestPeriod = Math.min(MAX_PERIOD, Math.floor((words.length - i) / MIN_REPEATS));
    for (let period = 1; period <= longestPeriod; period++) {
      let repeats = 1;
      while (
        i + (repeats + 1) * period <= words.length &&
        isRun(words, i, period, repeats + 1)
      ) {
        repeats++;
      }

      if (repeats >= MIN_REPEATS) {
        // Keep one copy, skip the rest.
        out.push(...words.slice(i, i + period));
        i += repeats * period;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      const word = words[i];
      if (word !== undefined) out.push(word);
      i++;
    }
  }

  return out.join(" ");
}

/** How much of the text was repetition, 0..1. */
export function repetitionRatio(original: string, repaired: string): number {
  const before = original.split(/\s+/).filter(Boolean).length;
  if (before === 0) return 0;
  const after = repaired.split(/\s+/).filter(Boolean).length;
  return (before - after) / before;
}

/**
 * Whether a transcript is so repetitive it should not be trusted as speech.
 *
 * Used to decide whether to carry it forward as the next chunk's continuity
 * prompt. Passing a degenerate transcript back to Whisper is what makes the
 * loop self-sustaining, so a heavily repaired chunk is better followed by no
 * prompt at all than by its own artefact.
 */
export function isDegenerate(original: string, repaired: string): boolean {
  return repetitionRatio(original, repaired) > 0.5;
}

/** One transcribed span, as returned by the ASR before offsets are absolutised. */
export interface RepairableSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Collapse a loop that spans SEGMENTS rather than sitting inside one.
 *
 * `collapseRepeats` works on a single string, so it repairs a phrase repeated
 * within one segment and nothing else. Whisper's other failure mode emits the
 * loop as a run of separate, individually-clean segments:
 *
 *   0:30  I'm going to make a video about it.
 *   0:32  I'm going to make a video about it.
 *   0:34  I'm going to make a video about it.        (…and twelve more)
 *
 * Each one collapses to itself, so the per-segment repair is a no-op and every
 * copy lands in the ledger as its own utterance. The chunk-level check DOES
 * notice — `isDegenerate` compares the joined text — but that verdict was only
 * ever logged, while the unrepaired segments were what got written. A real
 * drive stored ~20 identical rows this way.
 *
 * Keeps the FIRST occurrence and extends its end to cover the run, because the
 * driver did say something across that span; what is false is the claim that
 * they said it fifteen times.
 *
 * Same MIN_REPEATS threshold and the same reasoning as the text-level repair:
 * two adjacent identical segments could be a person repeating themselves, and
 * the ledger is meant to hold that. Three is a machine looping.
 */
export function collapseRepeatedSegments<T extends RepairableSegment>(segments: T[]): T[] {
  const key = (s: T) => s.text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");

  const out: T[] = [];
  for (let i = 0; i < segments.length; ) {
    let run = 1;
    while (i + run < segments.length && key(segments[i + run]!) === key(segments[i]!) && key(segments[i]!) !== "") {
      run += 1;
    }
    if (run >= MIN_REPEATS) {
      // One utterance covering the whole run, rather than N identical ones.
      out.push({ ...segments[i]!, end: segments[i + run - 1]!.end });
      i += run;
    } else {
      for (let k = 0; k < run; k++) out.push(segments[i + k]!);
      i += run;
    }
  }
  return out;
}
