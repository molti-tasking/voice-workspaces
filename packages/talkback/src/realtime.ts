/**
 * The agent, for a speech-to-speech model.
 *
 * WHAT CHANGES WITH THE ENGINE. The Pipecat container ran transcription, a
 * text model and a voice in a row, and the model's turn was TEXT: it could
 * answer `<silence>`, and `SilenceGate` kept that from the speaker. A
 * speech-to-speech model answers in audio, so there is nothing to gate — a
 * `<silence>` in its instructions would be read out. Whether a pause ends
 * their turn is the provider's own turn detection now (semantic, see
 * `realtimeSessionConfig`), and what is left to the prompt is how little to
 * say when they are still mid-thought.
 *
 * It also HEARS them. The text model got a transcript with `(pause 4s)`
 * marks and was told it could not hear their tone; this one gets their
 * voice. And it gets nothing per turn: no recall, no board, no drafts, no
 * search. What it knows is in these instructions, fixed when the
 * conversation starts.
 *
 * THE DISPLAY STUDY'S AGENT STAYS THE ONE IT WAS, as far as the engine
 * allows. `REALTIME_SESSION_PROMPT` is `SESSION_SYSTEM_PROMPT` with exactly
 * the passages that depend on the sentinel or the transcript replaced, and
 * `replaced` throws at import if one of them is no longer there — so an edit
 * to the shared wording reaches both engines, and an edit to a replaced
 * passage cannot slip past unnoticed.
 *
 * Pure: the browser imports the nudges from here (`@voicemural/talkback/realtime`).
 */

import type {
  RealtimeEagerness,
  RealtimeFunctionTool,
  RealtimeSessionConfig,
  RealtimeTranscriptionConfig,
} from "@voicemural/llm";
import { LOOKUP_SECTION, withLookup } from "./lookup";
import { PROFILE, type ConversationProfile } from "./profile";
import {
  FLOOR_OPEN_NOTE,
  FLOOR_SECTION,
  HEARING_SECTION,
  OPENING_NUDGE,
  PAUSE_RESUME_NOTE,
  POKE_NUDGE,
  READING_SECTION,
  SILENCE_TOKEN,
  SPARK_NUDGES,
  SPARK_SECTION,
  composeSystemPrompt,
  sparkQuestionText,
  sparkText,
  type ComposedPrompt,
  type SparkKind,
} from "./prompt";
import { SESSION_OPENING_NUDGE, SESSION_PROFILE, SESSION_SYSTEM_PROMPT } from "./study-agent";
import type { SessionTask } from "./study-task";

/**
 * On every `agent_turn` this engine writes, in place of `TALKBACK_CONFIG_VERSION`,
 * so an analysis can always tell the two engines' turns apart.
 */
export const REALTIME_CONFIG_VERSION = "realtime-1";

/** `text` with `from` replaced by `to`, or an error naming what was not found. */
function replaced(text: string, from: string, to: string): string {
  if (!text.includes(from)) {
    throw new Error(`realtime prompt: the passage to replace is gone: ${from.slice(0, 80)}…`);
  }
  return text.replace(from, to);
}

/** What it gets of them: their voice, which it can mishear. */
export const REALTIME_HEARING_SECTION = `You hear their voice itself, not a transcript of it: their words, and how they say them. The line can be noisy and you can mishear — names and places above all. When a word or question makes no sense in what you have been talking about, it was most likely misheard: say in a few words what you think they meant, or ask, rather than acting on the odd word.`;

/** Being read a text (talkback-24), with nothing to decline with but "Go on." */
export const REALTIME_READING_SECTION = `WHEN THEY READ SOMETHING OUT
When they read you a text — notes, a message, a list, a draft — everything they say until they have finished is the text, not talk to you. Its questions, claims and conclusions are not put to you, and a pause between its sentences is them reading on. While they read, say nothing; if you must say anything, say only "Go on." They have finished when they say so ("that's it") or turn to you ("what do you think?"); then answer, about the whole of it.`;

const STAY_QUIET = `They are mid-sentence, trailing off, or clearly still working a thought out ("so, um, maybe if…"): reply with exactly <silence>. Wait for the thought to finish.`;
const STAY_QUIET_REALTIME = `They are mid-sentence, trailing off, or clearly still working a thought out ("so, um, maybe if…"): say nothing more than "Mm." or "Go on.", and let them finish the thought.`;

/**
 * The display study's agent (`SESSION_SYSTEM_PROMPT`), for this engine: the
 * same partner on the phone, with three passages swapped — how to stay quiet,
 * being read to, and what it hears.
 */
export const REALTIME_SESSION_PROMPT = replaced(
  replaced(
    replaced(SESSION_SYSTEM_PROMPT, STAY_QUIET, STAY_QUIET_REALTIME),
    READING_SECTION,
    REALTIME_READING_SECTION,
  ),
  `Before each turn you may be shown what they said earlier in this conversation. ${HEARING_SECTION}`,
  REALTIME_HEARING_SECTION,
);

/** Sparks and keeping, with "Okay." where the field agent had the sentinel. */
const REALTIME_SPARK_SECTION = replaced(
  SPARK_SECTION,
  "so reply <silence>.",
  `so say only "Okay."`,
).replace(` If a reply is required of you anyway, say only "Okay."`, "");

/**
 * The field app's thinking companion, for this engine. Not derived from
 * `SYSTEM_PROMPT`, which is built around what the text pipeline gave it — the
 * transcript of earlier drives, the board, drafts, search — none of which this
 * engine has. What carries over is the stance: brief, present, and out of
 * the way of a thought still forming.
 */
export const REALTIME_FIELD_PROMPT = `You are a thinking companion alongside someone thinking aloud while their hands and attention are on something else — driving, walking, washing up. You are talking with them live, by voice.

Most of what you hear is someone working a thought out for themselves, and that thinking is the point. Your job is to make it go better: answer when asked, react when a thought lands, give one push when they are stuck — and stay out of the way while a thought is still forming.

WHEN TO SPEAK
- A question put to you is ALWAYS answered, including hard or open ones like "what do you think?". Take the most likely reading and answer it.
- When they tell you that you are wrong, say so in a few words, and give the right answer if you have one.
- If your last turn asked them something, their next words are its answer: act on it.
- When a thought clearly lands — a conclusion, a decision, a plan — you may say the one thing worth saying: a sharper phrasing, the obvious objection, or the question that moves it on. One sentence, then stop.
- When they are stuck — circling the same point, "I don't know" — offer one small push.
- When they are mid-sentence, trailing off or still forming a thought, say nothing more than "Mm." and let them go on. Never fill a pause just because it is a pause.
- Never say again what you have just said, and never ask a question two turns running.

${FLOOR_SECTION}

${REALTIME_READING_SECTION}

${REALTIME_SPARK_SECTION}

WHAT YOU HEAR
${REALTIME_HEARING_SECTION}

WHAT YOU CAN AND CANNOT DO
- You only talk. You cannot write anything down, keep notes, change their board, look anything up or send anything; never say you have, and never offer to.
- This conversation is the only one you know, with anything you are told below about one it continues. Nothing from their other recordings reaches you; if they ask about one, say you only know this conversation.
- You cannot see their screen: never describe it or tell them where to tap.
- You cannot change how you behave for later turns; if they ask for something different, do it now.
- When you do not know something, say so. Never invent a name, a date, a number or a decision.

HOW TO SPEAK
- Very short: one sentence, occasionally two. Say the one thing worth saying and stop.
- Be concrete, and name the actual thing.
- Answer in the language they are speaking.
- If they did not catch what you said, say it again.`;

/** The field profile, without the drafts this engine cannot make. */
export const REALTIME_FIELD_PROFILE: ConversationProfile = {
  ...PROFILE,
  stanza: replaced(
    PROFILE.stanza,
    "\n- What you have captured — drafts, tasks — is kept in their workspace for when they stop, and a draft also shows as a line in the conversation view. You may refer to it briefly; never read it aloud.",
    "",
  ),
};

/**
 * The last word, as `SPEECH_ONLY_CONTRACT` is for the text pipeline: how a
 * reply sounds, restated after everything composed above it so a section
 * cannot talk it out of plain speech.
 */
export const REALTIME_CONTRACT = `HOW YOU SPEAK — THIS OVERRIDES ANYTHING ABOVE
Everything you say is heard, live; nothing is shown as text.
- Plain speech only: no lists read aloud, no headings, no "firstly, secondly", no stage directions, no emoji.
- No preamble and no sign-off: do not announce what you are about to say, or that you are thinking.
- One question at most, and only when it moves the thought on.

If any instruction above conflicts with this section, this section wins.`;

/** The language named for the model, by catalogue code (`language.ts`). */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  de: "German",
  da: "Danish",
  es: "Spanish",
};

/** What the instructions say beyond the agent itself: when, where, and what came before. */
export interface RealtimeBackground {
  /** `renderLocalTime` at the start: the only clock it gets. */
  localTime?: string | null;
  /** One line about their screen, e.g. `STUDY_SCREEN`. */
  screen?: string | null;
  /** `renderContinued` of the conversation this drive continues. */
  continued?: string | null;
  /** A catalogue code when the drive is pinned to a language; null for auto-detect. */
  language?: string | null;
  /** It can look things up (`lookup.ts`): the mock search is on for this deployment. */
  lookup?: boolean;
}

function backgroundSections(background: RealtimeBackground): string[] {
  const sections: string[] = [];
  if (background.localTime) {
    // A clock read once, at the start, and said to be: "it is 10:14" an hour
    // into a drive is the invented clock of 7 Oct 2026 again.
    sections.push(`${background.localTime} That is when this conversation started; you have no clock after it.`);
  }
  if (background.screen) sections.push(background.screen);
  const name = background.language ? LANGUAGE_NAMES[background.language] : undefined;
  if (name) sections.push(`LANGUAGE\nThis conversation is in ${name}. Speak ${name} throughout, unless they switch.`);
  if (background.continued) sections.push(background.continued);
  if (background.lookup) sections.push(LOOKUP_SECTION);
  return sections;
}

/** The display study's session agent, for one task. */
export function composeRealtimeSessionPrompt(task: SessionTask, background: RealtimeBackground = {}): ComposedPrompt {
  return composeSystemPrompt({
    base: background.lookup ? withLookup(REALTIME_SESSION_PROMPT) : REALTIME_SESSION_PROMPT,
    profile: SESSION_PROFILE,
    sections: [task.agentSection, ...backgroundSections(background)],
    contract: REALTIME_CONTRACT,
  });
}

/** Everyone else's agent: the field app's companion. */
export function composeRealtimeFieldPrompt(background: RealtimeBackground = {}): ComposedPrompt {
  return composeSystemPrompt({
    base: background.lookup ? withLookup(REALTIME_FIELD_PROMPT) : REALTIME_FIELD_PROMPT,
    profile: REALTIME_FIELD_PROFILE,
    sections: backgroundSections(background),
    contract: REALTIME_CONTRACT,
  });
}

/**
 * A nudge for this engine: the text pipeline's, without the sentence telling
 * the model the sentinel is not available — there is no sentinel to withhold.
 */
function withoutSentinel(nudge: string): string {
  const text = nudge.replaceAll(`${SILENCE_TOKEN} is not available on this turn. `, "");
  if (text.includes(SILENCE_TOKEN)) throw new Error(`realtime nudge still names the sentinel: ${nudge.slice(0, 80)}…`);
  return text;
}

/** What the person asked for when they poked. */
export const REALTIME_POKE_NUDGE = withoutSentinel(POKE_NUDGE);

/** A pulled spark about `subject`: its kind's question, or the one written for it. */
export function realtimeSparkNudge(kind: SparkKind, subject: string, question?: string | null): string {
  return withoutSentinel(question ? sparkQuestionText(subject, question) : sparkText(SPARK_NUDGES[kind], subject));
}

/** After an unlock, and after the display study's game: as the container said them. */
export const REALTIME_UNLOCK_NOTE = FLOOR_OPEN_NOTE;
export const REALTIME_RESUME_NOTE = PAUSE_RESUME_NOTE;

/** The opening line's instruction, or null for an agent that waits to be spoken to. */
export function realtimeOpeningNudge({ session, proactiveOffers }: { session: boolean; proactiveOffers: boolean }): string | null {
  if (session) return SESSION_OPENING_NUDGE;
  return proactiveOffers ? OPENING_NUDGE : null;
}

/**
 * Which of the provider's voices speaks for each catalogue voice (`voice.ts`).
 * The catalogue's ids are ElevenLabs voices, which this engine cannot use; the
 * id is still what is stored, so the choice on the recorder still means one
 * voice per id. Code, not env, for the same reason as the catalogue.
 */
const REALTIME_VOICES: Readonly<Record<string, string>> = {
  XHqlxleHbYnK8xmft8Vq: "marin",
  x86DtpnPPuq2BpEiKPRy: "cedar",
  A9evEp8yGjv4c3WsIKuY: "coral",
};
export const DEFAULT_REALTIME_VOICE = "marin";

export function realtimeVoiceFor(voiceId: string | null | undefined): string {
  return (voiceId && REALTIME_VOICES[voiceId]) || DEFAULT_REALTIME_VOICE;
}

/** Their turn ends when the provider's semantic detector hears it end. */
export type RealtimeTurnDetection = RealtimeSessionConfig["audio"]["input"]["turn_detection"];

export function realtimeTurnDetection(eagerness: RealtimeEagerness): RealtimeTurnDetection {
  return { type: "semantic_vad", eagerness, create_response: true, interrupt_response: true };
}

/**
 * The session the secret is minted for. Semantic turn detection, the
 * provider's own and the reason for this engine: whether a pause ends their
 * turn is judged from what they said and how, not from a fixed silence.
 * Transcription of their side is for the screen and the record; the model
 * itself hears the audio. Near-field noise reduction, for a phone held close.
 */
export function realtimeSessionConfig({
  model,
  instructions,
  voice,
  language,
  transcribeModel,
  eagerness,
  tools = [],
}: {
  model: string;
  instructions: string;
  voice: string;
  language: string | null;
  transcribeModel: string;
  eagerness: RealtimeEagerness;
  /** Functions it may call, run by the browser. */
  tools?: RealtimeFunctionTool[];
}): RealtimeSessionConfig {
  return {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: {
        transcription: { model: transcribeModel, ...(language ? { language } : {}) },
        noise_reduction: { type: "near_field" },
        turn_detection: realtimeTurnDetection(eagerness),
      },
      output: { voice },
    },
    ...(tools.length > 0 ? { tools, tool_choice: "auto" as const } : {}),
  };
}

/**
 * The transcription-only session beside the conversation
 * (`REALTIME_LIVE_TRANSCRIBE_MODEL`): their words while they are saying them,
 * for the screen only — the record is still the conversation's own transcript
 * of the turn, which replaces them once it is in. Same language and noise
 * reduction as the conversation.
 *
 * NO TURN DETECTION: a streaming model refuses it ("Turn detection is not
 * supported for this transcription model", gpt-live-transcribe through the
 * proxy, 29 Oct 2026). It writes as the audio comes and ends a segment only
 * when it is told to, so the browser commits its buffer where the
 * conversation's own turn ends, and its segments line up with their turns
 * (`RealtimeConversation.caption`). `model` is the provider's name.
 */
export function liveTranscriptionConfig({
  model,
  language,
}: {
  model: string;
  language: string | null;
}): RealtimeTranscriptionConfig {
  return {
    type: "transcription",
    audio: {
      input: {
        // Low: words on screen soon after they are said, a little context first.
        transcription: { model, ...(language ? { language } : {}), delay: "low" },
        noise_reduction: { type: "near_field" },
        turn_detection: null,
      },
    },
  };
}
