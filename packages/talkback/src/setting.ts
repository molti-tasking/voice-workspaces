/**
 * The setting a recording happens in.
 *
 * The premise of the whole system is that the voice interaction is NOT the
 * user's primary task, and the human skill being modelled is instantly adapting
 * how you converse to the situation you are in. A phone in a car cradle at
 * 110 km/h and a phone propped against the tap while someone does the washing
 * up are the same software and should not be the same interface.
 *
 * Deliberately NOT a fifth `capability.type`. Notes.md argues for the closure of
 * mode/persona/action/rule, and a setting is not a capability the user authors —
 * it is a fact about where they are, chosen once per recording. It lives as a
 * column on `capture_session` and as the profile below.
 *
 * Pure: no I/O, no model call, fully testable.
 */

export const SETTINGS = ["driving", "walking", "hands_busy", "desk"] as const;
export type Setting = (typeof SETTINGS)[number];

/** The setting assumed for recordings made before the question was asked. */
export const DEFAULT_SETTING: Setting = "driving";

export interface SettingProfile {
  /** What a participant would call it. */
  label: string;
  /** One line under the label on the recorder. */
  hint: string;
  /**
   * Hard cap on reply length, in words, stated in the prompt.
   *
   * Every word is spoken aloud. 25 words is roughly ten seconds of talking,
   * which is already a monologue in a car; at a kitchen counter, where the user
   * can stop and listen, a longer answer is not an imposition.
   */
  maxReplyWords: number;
  /**
   * Whether the system may refer to the screen.
   *
   * The base prompt says "the driver cannot look at a screen ... do not offer to
   * show anything". That instruction is right for `driving` and wrong for
   * `desk`. This flag is the single switch between them, and it is also what
   * decides whether the cue panel renders at all — one fact, read in two places,
   * so voice and display can never disagree about whether a screen exists.
   */
  displayAllowed: boolean;
  /** Cue budget for the secondary display. Zero means the panel is suppressed. */
  maxContentCues: number;
  maxDirectionCues: number;
  /**
   * How forthcoming the system is allowed to be.
   *
   * Carried here rather than in the prompt text so that when the proactive
   * engine lands it reads this rather than inventing a second source of truth.
   * Today it only tunes the register stanza below.
   */
  proactivity: "quiet" | "occasional" | "forthcoming";
  /** Appended to the composed system prompt. Prose, because the model reads it. */
  stanza: string;
}

/**
 * The profiles, ordered from least to most attention the user can spare.
 *
 * `driving` reproduces the stance the base prompt was written with, so an
 * unset setting and an explicit `driving` behave identically — which is what
 * makes the column safely nullable for every recording made before this existed.
 */
export const SETTING_PROFILES: Record<Setting, SettingProfile> = {
  driving: {
    label: "Driving",
    hint: "Eyes on the road. Nothing on screen.",
    maxReplyWords: 25,
    displayAllowed: false,
    maxContentCues: 0,
    maxDirectionCues: 0,
    proactivity: "quiet",
    stanza: `THE SETTING
They are driving. Their hands and their eyes are busy and staying alive is the task; talking to you is not.

- Keep every reply under 25 words. Say the one thing worth saying and stop.
- They cannot look at a screen and cannot take notes. Never offer to show anything, and never say "I've put that on the screen".
- A pause is thinking. Do not fill it.`,
  },
  walking: {
    label: "Walking",
    hint: "Moving, pocket or headphones. Audio only.",
    maxReplyWords: 35,
    displayAllowed: false,
    maxContentCues: 0,
    maxDirectionCues: 0,
    proactivity: "occasional",
    stanza: `THE SETTING
They are walking. Their attention is freer than in a car, but the phone is in a pocket and everything reaches them as audio.

- Keep every reply under 35 words.
- They are not looking at a screen. Never offer to show anything.
- A pause is thinking. You may follow up once when a thought has clearly settled, but never twice.`,
  },
  hands_busy: {
    label: "Hands busy",
    hint: "Cooking, washing up. A screen you can glance at.",
    maxReplyWords: 45,
    displayAllowed: true,
    maxContentCues: 3,
    maxDirectionCues: 2,
    proactivity: "forthcoming",
    stanza: `THE SETTING
Their hands are busy — cooking, washing up, tidying — but a screen is propped nearby and they can glance at it.

- Keep every reply under 45 words.
- A short list of what you have captured is on that screen. You may refer to it, briefly, but do not read it aloud: they can see it.
- Anything that needs reading rather than hearing belongs on the screen, not in a reply.
- A pause is thinking, not a turn. Wait it out before following up.`,
  },
  desk: {
    label: "At a desk",
    hint: "Screen in front of you. The fullest view.",
    maxReplyWords: 60,
    displayAllowed: true,
    maxContentCues: 5,
    maxDirectionCues: 3,
    proactivity: "forthcoming",
    stanza: `THE SETTING
They are at a desk with the screen in front of them.

- Keep every reply under 60 words. It is still speech, and still spoken aloud.
- What you have captured is on the screen beside them. Refer to it rather than reciting it.
- They can read, so prefer putting detail on the screen and keeping your reply to the point of it.`,
  },
};

/** A stored value to a profile, tolerating null and anything unrecognised. */
export function settingProfile(setting: string | null | undefined): SettingProfile {
  return SETTING_PROFILES[asSetting(setting)];
}

/** Narrow an untrusted string to a `Setting`, falling back to the default. */
export function asSetting(value: string | null | undefined): Setting {
  return (SETTINGS as readonly string[]).includes(value ?? "")
    ? (value as Setting)
    : DEFAULT_SETTING;
}
