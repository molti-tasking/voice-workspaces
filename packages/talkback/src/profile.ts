/**
 * How the system converses: one profile, for every recording.
 *
 * THERE USED TO BE FOUR. A recording was tagged with where it happened —
 * driving, walking, hands busy, at a desk — and that chose the reply cap, how
 * forthcoming the agent was, whether it could mention the screen and how
 * dense the screen was. It was inferred from the accelerometer, corrected by
 * a row of buttons, remembered, stored, and explained on every surface, and by
 * September 2026 that machinery was more of the product than the thing it was
 * tuning. It was taken out entirely (Sep 2026); the old values survive on
 * `capture_session.setting` for the drives that ran under them, and the
 * question of where and when people actually use this is asked on `/survey`
 * instead of guessed from a sensor.
 *
 * WHAT IS LEFT is the middle of the old range. A screen exists — drafts and
 * the board are on it, and the welcome page's examples promise that — but the
 * agent is told to assume it is not being looked at. Replies stay short
 * because every word is spoken. Unprompted turns are allowed but not eager.
 *
 * Pure: no I/O, no model call, and deliberately free of any @voicemural/db
 * import, because the recorder is a client component that needs the cue
 * budgets. Exported as `@voicemural/talkback/profile` so the browser can
 * reach it without pulling in the package index, which re-exports
 * retrieval.ts and with it the Postgres driver.
 */

export type Proactivity = "quiet" | "occasional" | "forthcoming";

/**
 * How often the system may take an unasked-for turn, by level.
 *
 * The base prompt says WHAT earns a turn — a landed thought, a stuck person, a
 * question. These say HOW OFTEN. Every level keeps the two rules that never
 * move: nothing mid-thought, and never twice without a reply in between. None
 * of them lengthens a reply; the word cap is the profile's.
 *
 * Three levels are kept although only one is used: the proactive engine in
 * `bot.py` is keyed on them, and the eval cases exercise the others.
 */
export const PROACTIVITY_STANZAS: Record<Proactivity, string> = {
  quiet: `HOW FORTHCOMING TO BE
Sparingly. Most landed thoughts should pass without comment; speak on one only when you have something that genuinely sharpens or corrects it, and let the rest go. One push when they are clearly stuck, then wait. Never twice in a row without a reply.`,
  occasional: `HOW FORTHCOMING TO BE
Moderately. A short reaction when a thought lands is welcome, and one nudge when they seem stuck. At most once per thought, and never twice in a row without a reply.`,
  forthcoming: `HOW FORTHCOMING TO BE
Readily. Reacting when a thought lands is expected, and a settled pause after a complete thought is an invitation to move it on with one question. Still one sentence, still never mid-thought, still never twice in a row without a reply.`,
};

/**
 * How many seconds of silence may follow a completed, unanswered thought
 * before the proactive engine (`Offers` in `bot.py`) hands the model an
 * unprompted turn.
 *
 * The numbers are long on purpose — a pause that is thinking must never be
 * read as an invitation, and the engine fires only once per silence, with the
 * model free to decline via the sentinel. A declined offer backs off
 * exponentially rather than repeating the same question every interval.
 *
 * MIRRORED in `bot.py` as `PROACTIVE_AFTER_SECS` — change one, change both.
 */
export const PROACTIVE_AFTER_SECS: Record<Proactivity, number> = {
  quiet: 25,
  occasional: 12,
  forthcoming: 7,
};

/** How the secondary display is meant to be consumed. See `display/rules.ts`. */
export type Density = "glance" | "read";

export interface ConversationProfile {
  /** One line under the timer on the recorder while a drive runs. */
  hint: string;
  /**
   * Hard cap on reply length, in words, stated in the prompt.
   *
   * Every word is spoken aloud. Forty words is about fifteen seconds of
   * talking, which is already long for a reply to someone mid-thought.
   */
  maxReplyWords: number;
  /**
   * Whether the system may refer to the screen, and whether the cue panel
   * renders at all. One fact, read in both places, so voice and display can
   * never disagree about whether a screen exists.
   */
  displayAllowed: boolean;
  /** Cue budget for the secondary display. */
  maxContentCues: number;
  maxDirectionCues: number;
  density: Density;
  proactivity: Proactivity;
  /** Appended to the composed system prompt. Prose, because the model reads it. */
  stanza: string;
}

export const PROFILE: ConversationProfile = {
  hint: "Recording. Talk, or don't — it is listening.",
  maxReplyWords: 40,
  displayAllowed: true,
  maxContentCues: 8,
  maxDirectionCues: 4,
  // The workspace forming is the thing worth watching, and it can be shown
  // as the small structured document it actually is.
  density: "read",
  proactivity: "occasional",
  stanza: `THE SITUATION
They are thinking aloud, and talking to you is not their main task. Their hands and eyes may be on something else — a road, a pavement, a sink — so assume they are not looking at the screen.

- Keep every reply under 40 words. Say the one thing worth saying and stop.
- What you have captured — drafts, the board — is on the screen for when they stop. You may refer to it briefly; never read it aloud.
- A pause is thinking. Do not fill it.`,
};
