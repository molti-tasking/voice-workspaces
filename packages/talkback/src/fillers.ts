/**
 * The short things the system says when it is working rather than answering.
 *
 * WHY THIS EXISTS. On Pilot 01 a tool-backed turn took a median of 8.4s
 * against 1.3s for a turn without one, and nothing was spoken in between. In a
 * car, "thinking" and "the connection has dropped" sound identical, and the
 * participant had no way to tell which they were in. Silence is the system's
 * default stance everywhere else in this codebase and it is the right one —
 * but a silence the system chose and a silence it fell into must not sound the
 * same, and a lookup is the one moment the system is audibly doing nothing
 * while being very much alive.
 *
 * Three phrases, and nothing more:
 *
 * - `lookup` goes out BEFORE the tool call, the moment the model asks for one.
 * - `stillWorking` repeats once the call passes ~5s, and again every ~5s up to
 *   a cap. A second reassurance is the difference between "slow" and "gone";
 *   a fourth is nagging.
 * - `answerFallback` is the last resort of the open-question guard: the model
 *   was told it may not decline an answer to its own question, declined
 *   anyway, was asked again, and declined again. Saying this is bad; the
 *   40.4s of dead air that ended Pilot 01 is worse.
 *
 * IN THE DRIVE'S LANGUAGE, not the deployment's. A German phrase read to an
 * English speaker is its own failure, so these are keyed by the same
 * `stt_language` the drive chose (`language.ts`) and fall back to English
 * where the drive auto-detects — the honest choice, since nothing has told us
 * what language this drive is in.
 *
 * SPOKEN, so: no markdown, no brackets, nothing a synthesiser reads as
 * punctuation salad, and short enough to be over before the result arrives.
 *
 * EVERY ONE OF THESE IS WRITTEN TO `agent_turn` when it is spoken, as kind
 * `filler`. Not bookkeeping: `agent_turn` is the echo filter's only input, and
 * a phrase that reached the speaker without a row there comes back through the
 * microphone as something the participant said. It is also why the kind
 * exists — a 0.2s filler counted as a reply would hide the 8.4s wait it was
 * covering.
 *
 * Pure, and free of any @voicemural/db import, like `setting.ts` and
 * `language.ts` beside it.
 */

export interface SpokenFillers {
  /** Said as a lookup starts. */
  lookup: string;
  /** Said again while it is still running. */
  stillWorking: string;
  /** Said when the model will not answer an answer. See the guard in bot.py. */
  answerFallback: string;
}

/**
 * Keyed by the drive's `stt_language`.
 *
 * Add a language here and to `STT_LANGUAGES` together: a drive can only be
 * recorded in a language the picker offers, and a filler for a language the
 * picker does not offer is unreachable.
 */
export const FILLERS: Record<string, SpokenFillers> = {
  en: {
    lookup: "One moment, I'm looking that up.",
    stillWorking: "Still looking.",
    answerFallback: "Sorry — say that again?",
  },
  de: {
    lookup: "Moment, ich schaue nach.",
    stillWorking: "Ich schaue noch.",
    answerFallback: "Entschuldigung — sagen Sie das noch einmal?",
  },
};

/** What a drive with no stated language hears. */
export const DEFAULT_FILLER_LANGUAGE = "en";

/**
 * The phrases for one drive.
 *
 * Tolerates a full BCP-47 tag (`de-AT`) by taking the primary subtag, and
 * anything unknown — including null, which is auto-detect — by falling back
 * to English.
 */
export function fillersFor(language: string | null | undefined): SpokenFillers {
  const primary = (language ?? "").split("-")[0]?.toLowerCase() ?? "";
  return FILLERS[primary] ?? FILLERS[DEFAULT_FILLER_LANGUAGE]!;
}

/**
 * How long a tool call may run before the first reassurance.
 *
 * Five seconds: Pilot 01's tool-backed median was 8.4s, so this fires on
 * roughly the slower half of lookups and never on a fast one. MIRRORED in
 * `bot.py` as `REASSURE_AFTER_SECS` — change one, change both.
 */
export const REASSURE_AFTER_SECS = 5;

/**
 * How many reassurances one call may get before the system stops talking
 * about itself. Two, then it waits like everyone else.
 *
 * MIRRORED in `bot.py` as `MAX_REASSURANCES`.
 */
export const MAX_REASSURANCES = 2;
