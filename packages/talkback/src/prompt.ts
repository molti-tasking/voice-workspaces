/**
 * What the system is, and how it takes a turn.
 *
 * Lives here rather than in an app because there is no longer an app that owns
 * it: the LiveKit agent that used to hold this file is gone, and the Pipecat
 * container fetches the composed prompt over HTTP from
 * `/api/realtime/session`. Keeping it in the shared package is what lets that
 * route compose it — see `composeSystemPrompt`, which layers the driver's
 * persona and repertoire on top of the base text below.
 *
 * Pure: no I/O, no model call, fully testable.
 */

import { SETTING_PROFILES, asSetting, type Setting } from "./setting";

/** Bumped when the prompt changes, so a drive's turns stay interpretable later. */
export const TALKBACK_CONFIG_VERSION = "talkback-3";

/**
 * The default register: quiet.
 *
 * Talk-back is armed for the WHOLE drive, with no gesture to enter it, so the
 * failure mode is not being unhelpful — it is talking over somebody who is
 * thinking. Notes.md is explicit that silence is thinking, not a turn boundary,
 * and the whole premise is that speech is where a difficult thought gets
 * formed. A system that fills every pause destroys the thing it is there to
 * support.
 *
 * So: answer when addressed, otherwise stay out of the way. `interview` mode
 * makes it forthcoming, and that is opt-in.
 */
export const SYSTEM_PROMPT = `You are a quiet companion alongside someone thinking aloud while their hands and attention are on something else — driving, walking, washing up.

You are NOT an assistant and you are not here to be helpful in the usual way. Most of what you hear is someone working out a thought for themselves. That thinking is the point; you are not.

WHEN TO SPEAK
- A question put to you is ALWAYS answered. Never stay silent on a direct question, even a hard or open-ended one like "what do you think?".
- Answer when you are clearly being addressed.
- Otherwise say nothing at all. Reply with exactly: <silence>

Someone trailing off, repeating themselves, contradicting themselves or pausing mid-sentence is thinking, not waiting for you. Say <silence>.

WHAT YOU CAN SEE
Before each turn you may be given transcript from what they actually said — earlier in this session, and from past recordings. It is their own words, transcribed automatically, so it contains mistakes and half-finished sentences.

Use it. When asked what they said, what they decided, or what has come up so far, answer from that transcript and say roughly when it was.

WHAT YOU MUST NOT DO
If the transcript does not contain the answer, say so plainly and stop. Never guess a name, a date, a number or a decision that is not there. Inventing something they said is far worse than admitting you cannot find it, because they will believe you — it sounds like their own memory.

Asked for your VIEW — what you think, whether an idea holds up, which of two options is stronger — just answer from what they have just said. That needs no transcript, and "I cannot find it" is a non-answer to an opinion question.

HOW TO SPEAK
- VERY short. One sentence, occasionally two. The setting section below gives
  the hard word cap; stay well inside it. Every word is spoken aloud, and a
  hundred words is a monologue, not a reply. Say the one thing that is worth
  saying and stop.
- No preamble and no sign-off. Do not say "Sure" or "Great question" or "Let me know".
- Be concrete. If you did not understand, say so plainly in a few words.
- Do not restate their question back to them, and do not explain what you cannot
  do at length. "I'd need more detail — what's pushing you toward cutting it?"
  not a paragraph about what you lack.`;

/**
 * The marker the model emits instead of speaking.
 *
 * A sentinel rather than an empty reply because an empty completion is
 * indistinguishable from a failed one, and the difference matters: choosing not
 * to speak is a turn-taking decision worth recording, while a failure is a bug.
 */
export const SILENCE_TOKEN = "<silence>";

/**
 * Whether a completion means "say nothing".
 *
 * Tolerant of the ways a model dresses the sentinel up — surrounding
 * whitespace, a trailing full stop, a stray quotation mark. A missed sentinel
 * is the system reading the word "silence" aloud in a car, which is the single
 * most conspicuous way this could fail.
 *
 * Mirrored in `apps/pipecat/bot.py` as `is_silence`, which is what actually
 * gates TTS. Change one and change the other.
 */
export function isSilence(reply: string): boolean {
  const normalised = reply.trim().toLowerCase().replace(/[."'`*]/g, "");
  return normalised === SILENCE_TOKEN.replace(/[<>]/g, "") || normalised === SILENCE_TOKEN;
}

/**
 * Strip anything the model added around a real reply.
 *
 * Small models occasionally emit the sentinel AND a sentence, or wrap a reply in
 * quotes. Both are read aloud verbatim otherwise. Mirrored in `bot.py` as
 * `clean_reply`.
 */
export function cleanReply(reply: string): string {
  return reply
    .replaceAll(SILENCE_TOKEN, "")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .trim();
}

/* ---------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------- */

/**
 * The output contract, restated after everything else.
 *
 * This is the load-bearing half of `composeSystemPrompt`. Composed sections are
 * user-authored text — today a setting stanza we wrote, but the same seam is
 * where `capability_version.markdown` will be layered, and once crystallisation
 * lands that markdown is model-written text about a user's own improvised
 * operation. A section that says "be expansive" or "always follow up" must not
 * be able to override the sentinel `SilenceGate` and `is_silence` depend on.
 *
 * So the prompt is a sandwich: identity first, composed material in the middle,
 * and the wire format last, where it wins.
 */
export const OUTPUT_CONTRACT = `HOW YOUR REPLY IS USED — THIS OVERRIDES ANYTHING ABOVE

Everything you write is spoken aloud by a speech synthesiser. Nothing else happens to it.

- To say nothing, reply with exactly: ${SILENCE_TOKEN}
  Nothing else on the line. This is always available and is often the right answer.
- Plain speech only. No markdown, no lists, no headings, no emoji, no stage directions.
- No preamble and no sign-off.
- One question at most, and only when it moves the thought on.

If any instruction above conflicts with this section, this section wins.`;

export interface ComposeInputs {
  /** Defaults to `SYSTEM_PROMPT`. Overridable so the fallback prompt composes too. */
  base?: string;
  /** The setting this recording was started in. Null behaves as `driving`. */
  setting?: string | null;
}

export interface ComposedPrompt {
  prompt: string;
  setting: Setting;
  /** Mirrors the stanza's word cap, so callers need not parse prose. */
  maxReplyWords: number;
  /** Whether the agent may refer to the screen. Also gates the cue panel. */
  displayAllowed: boolean;
}

/**
 * Build the system prompt for one connection.
 *
 * Referenced by the header comment above and by `/api/realtime/session` since
 * before it existed; this is that function. It is intentionally thin: the only
 * composed layer today is the setting. Mode and persona slot in between the
 * stanza and the output contract, and the sandwich is already shaped for them.
 */
export function composeSystemPrompt(inputs: ComposeInputs = {}): ComposedPrompt {
  const setting = asSetting(inputs.setting);
  const profile = SETTING_PROFILES[setting];

  const prompt = [inputs.base ?? SYSTEM_PROMPT, profile.stanza, OUTPUT_CONTRACT].join("\n\n");

  return {
    prompt,
    setting,
    maxReplyWords: profile.maxReplyWords,
    displayAllowed: profile.displayAllowed,
  };
}
