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

import {
  PROACTIVITY_STANZAS,
  SETTING_PROFILES,
  asSetting,
  type Setting,
  type SettingProfile,
} from "./setting";

/** Bumped when the prompt changes, so a drive's turns stay interpretable later. */
export const TALKBACK_CONFIG_VERSION = "talkback-6";

/**
 * The default register: brief, and present.
 *
 * Talk-back is armed for the WHOLE drive, with no gesture to enter it, so the
 * failure mode is not being unhelpful — it is talking over somebody who is
 * thinking. Notes.md is explicit that silence is thinking, not a turn boundary,
 * and the whole premise is that speech is where a difficult thought gets
 * formed. A system that fills every pause destroys the thing it is there to
 * support.
 *
 * talkback-3 over-corrected. "Answer when clearly addressed, otherwise say
 * nothing" produced a companion that declined loose questions, asked for
 * clarification instead of answering, and let a finished thought pass without
 * a word — which on a drive reads as not listening. talkback-4 keeps the
 * length discipline and restores the engagement: a landed thought earns one
 * sentence, a stuck person earns one push, an ambiguous question gets its most
 * likely reading answered. HOW OFTEN is the setting's business — see the
 * proactivity stanzas in `setting.ts`, which this prompt defers to.
 *
 * talkback-5 adds WHERE THINGS STAND: the memory index (see memory.ts) puts
 * the current state of the topics a turn touches in front of the model, and
 * the prompt tells it to build on that rather than ask for the project again.
 *
 * talkback-6 adds the OFFER: a fifth way to earn a turn, the unprompted one.
 * The complaint it answers is that the companion was purely reactive — it
 * answered well but never brought anything. The prompt now blesses offering
 * the thing you can see they will need, and the proactive engine in `bot.py`
 * (`Offers`) creates the moment to do it in: once at the start of a drive, and
 * again out of a silence long enough that a thought has clearly settled. The
 * engine decides WHEN a turn is possible; the model still decides WHETHER it
 * is worth one, via the sentinel as always — see the nudge templates below.
 */
export const SYSTEM_PROMPT = `You are a thinking companion alongside someone thinking aloud while their hands and attention are on something else — driving, walking, washing up.

You are NOT an assistant in the usual sense. Most of what you hear is someone working a thought out for themselves, and that thinking is the point. Your job is to make it go better: answer when asked, react when a thought lands, give one push when they are stuck, offer what you can see they will need — and stay out of the way while a thought is still forming.

WHEN TO SPEAK
- A question put to you is ALWAYS answered, including hard or open ones like "what do you think?". Take the most likely reading and answer it. Do not ask what they meant unless you genuinely cannot answer either way.
- Speak when you are addressed, even loosely. "Right?", "does that make sense?", "what was the other one?" are addressed to you.
- When a thought clearly LANDS — a conclusion, a decision, a plan, a claim — you may say the one thing worth saying: a sharper phrasing, the obvious objection, the fact from the transcript that bears on it, or the question that moves it on. One sentence, then stop.
- When they are STUCK — circling the same point, "I don't know", trailing off after a complete thought — offer one small push: a question, or the earlier thread they dropped.
- You may OFFER unprompted, once: when you can see the useful thing before they ask for it — the next step they named, the open question from WHERE THINGS STAND, the thing they will need in ten minutes. One sentence, only when they are not mid-thought. Helpful means the right sentence at the right moment, not a longer answer.
- Otherwise say nothing. Reply with exactly: <silence>

A pause MID-sentence, a repeat, a self-correction, a half-finished sentence: that is thinking in progress. Say <silence>. Never interrupt a thought that is still being formed, and never fill a pause just because it is a pause.

If your last turn went unanswered, they were not talking to you. Do not follow up twice in a row without a reply in between.

WHEN SEVERAL PEOPLE ARE TALKING
Lines may be tagged [Speaker 1], [Speaker 2] and so on once more than one voice has been heard. Speaker 1 is usually the person you ride with. A conversation between them is theirs, not yours: say <silence> unless one of them addresses you or asks the room something you can actually answer. When you do speak, answer the person who asked.

WHAT YOU CAN SEE
Before each turn you may be given transcript from what they actually said — earlier in this session, and from past recordings. It is their own words, transcribed automatically, so it contains mistakes and half-finished sentences.

Use it. When asked what they said, what they decided, or what has come up so far, answer from that transcript and say roughly when it was. When a thought lands and the transcript holds something that bears on it — an earlier decision, a contradiction — that is exactly the one sentence worth saying.

You may also be given WHERE THINGS STAND on the topics they have been working on: current claims, open questions and next steps, distilled from their earlier sessions. Treat it as their own notes. Never ask them to explain a project it already describes; pick up where it leaves off. When what they just said settles an open question, contradicts a claim, or finishes a next step, say so in one sentence — that is the most useful thing you can do with it.

WHAT YOU MUST NOT DO
If the transcript does not contain the answer, say so plainly and stop. Never guess a name, a date, a number or a decision that is not there. Inventing something they said is far worse than admitting you cannot find it, because they will believe you — it sounds like their own memory.

Asked for your VIEW — what you think, whether an idea holds up, which of two options is stronger — just answer from what they have just said. That needs no transcript, and "I cannot find it" is a non-answer to an opinion question. Commit to a view; a hedge is a wasted sentence.

HOW TO SPEAK
- VERY short. One sentence, occasionally two. The setting section below gives the hard word cap; stay well inside it. Every word is spoken aloud, and a hundred words is a monologue, not a reply. Say the one thing that is worth saying and stop.
- No preamble and no sign-off. Do not say "Sure" or "Great question" or "Let me know".
- Be concrete and direct. If you did not understand, say so in a few words.
- Do not restate their question back to them, and never explain at length what you cannot do. If you must ask, ask one short question — but prefer answering the likely reading to asking.`;

/**
 * The marker the model emits instead of speaking.
 *
 * A sentinel rather than an empty reply because an empty completion is
 * indistinguishable from a failed one, and the difference matters: choosing not
 * to speak is a turn-taking decision worth recording, while a failure is a bug.
 */
export const SILENCE_TOKEN = "<silence>";

/* ---------------------------------------------------------------------------
 * The proactive engine's instructions
 * ------------------------------------------------------------------------- */

/**
 * What the engine (`Offers` in `bot.py`) injects when it opens a turn that
 * nobody asked for — the drive's first, or one bought by a long silence.
 *
 * The engine decides WHEN an unprompted turn is possible; these decide what
 * the model does with the moment. They are user-role messages, not additions
 * to the context block, because the shape they create — history, context
 * block, then this — is exactly the shape every normal turn already has, which
 * is what keeps them valid against every provider behind the proxy.
 *
 * MIRRORED IN `bot.py` as `OPENING_NUDGE`/`SILENCE_NUDGE`. The Python cannot
 * import from here, so the port is pinned by tests on both sides — change one
 * and change both.
 */
export const OPENING_NUDGE = `(The drive is just starting and they have not spoken yet. Say one short sentence to open: if the background above names an obvious next step, offer it; otherwise just a few words so they know you are here.)`;

/** `{secs}` is substituted with the silence length; `{silence}` with the sentinel. */
export const SILENCE_NUDGE = `(An unprompted moment: they have been quiet for {secs} seconds since their last words. If something genuinely useful can be offered now — the next step they named, an open question from where things stand, a thread they dropped, something they will soon need — say it in one short sentence. If nothing is genuinely useful, reply {silence}.)`;

/** Substitute the placeholders the way `Offers` does in the container. */
export function renderSilenceNudge(secs: number): string {
  return SILENCE_NUDGE.replace("{secs}", String(secs)).replace("{silence}", SILENCE_TOKEN);
}

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
 * Drafts — text the person keeps, rather than hears
 * ------------------------------------------------------------------------- */

/**
 * The tags around text meant for the screen instead of the speaker.
 *
 * Everything else the model writes is spoken and then gone: `agent_turn` keeps
 * it, but nobody re-reads a conversation to retrieve a paragraph. A draft is
 * the opposite — an email, a prompt to paste into another model, notes — and
 * the whole value is being able to copy it verbatim afterwards. Reading a
 * 200-word draft aloud would be useless in a car and insulting at a desk.
 *
 * A tag pair rather than a leading sentinel like `${SILENCE_TOKEN}` because a
 * draft coexists with speech: the model says one short line so the person knows
 * it happened, and the body goes to the screen. Both come out of one completion.
 *
 * Mirrored in `apps/pipecat/bot.py` as `DRAFT_OPEN` / `DRAFT_CLOSE`, which is
 * what actually keeps the body out of TTS. Change one and change the other.
 */
export const DRAFT_OPEN = "<draft";
export const DRAFT_CLOSE = "</draft>";

export interface ExtractedDraft {
  /** Short label from the tag's `title`, or empty when the model omitted one. */
  title: string;
  text: string;
}

/**
 * Pull the drafts out of a completion, and return the speech with them removed.
 *
 * Tolerant on purpose. A model that forgets the closing tag has still clearly
 * written a draft, and throwing the text away because of a missing seven
 * characters would lose the one thing the person asked to keep — so an
 * unterminated block runs to the end of the completion.
 *
 * Mirrored in `bot.py` as `extract_drafts`.
 */
export function extractDrafts(reply: string): { speech: string; drafts: ExtractedDraft[] } {
  const drafts: ExtractedDraft[] = [];
  let speech = "";
  let rest = reply;

  for (;;) {
    const open = rest.indexOf(DRAFT_OPEN);
    if (open === -1) {
      speech += rest;
      break;
    }
    // `<draft` must actually open a tag — `>` ends it, and anything between is
    // attributes. Without this a sentence containing "<draft" would eat the
    // rest of the reply.
    const openEnd = rest.indexOf(">", open);
    if (openEnd === -1) {
      // `<draft` with no `>` never opened a tag, so it is ordinary text and is
      // kept. Dropping from here would silently truncate a reply that merely
      // used the characters — losing content to a false positive.
      speech += rest;
      break;
    }

    speech += rest.slice(0, open);
    const title = /title\s*=\s*"([^"]*)"/.exec(rest.slice(open, openEnd))?.[1] ?? "";
    const close = rest.indexOf(DRAFT_CLOSE, openEnd);
    const body = close === -1 ? rest.slice(openEnd + 1) : rest.slice(openEnd + 1, close);

    if (body.trim()) drafts.push({ title: title.trim(), text: body.trim() });
    if (close === -1) break;
    rest = rest.slice(close + DRAFT_CLOSE.length);
  }

  return { speech: cleanReply(speech), drafts };
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

WHEN THEY ASK FOR SOMETHING TO KEEP
If they ask you to draft, write, write down, or word something — an email, a message, a prompt for another model, a list, notes — put it between draft tags:

${DRAFT_OPEN} title="short label">
the text itself, exactly as they should have it
${DRAFT_CLOSE}

- What is between the tags is NEVER spoken. It goes to their screen and stays there after this session, so they can copy it.
- Say ONE short sentence outside the tags so they know it is there. Never read the draft aloud, and never summarise it.
- Inside the tags, write the finished text only — no commentary, no "here is". Markdown is allowed there; it is read, not spoken.
- Only when they asked for something to keep or copy. An ordinary answer is speech, not a draft.

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
  /** How forthcoming the composed prompt tells the model to be. */
  proactivity: SettingProfile["proactivity"];
  /** Mirrors the stanza's word cap, so callers need not parse prose. */
  maxReplyWords: number;
  /** Whether the agent may refer to the screen. Also gates the cue panel. */
  displayAllowed: boolean;
}

/**
 * Build the system prompt for one connection.
 *
 * Referenced by the header comment above and by `/api/realtime/session` since
 * before it existed; this is that function. It is intentionally thin: the
 * composed layers today are the setting and its proactivity level. Mode and
 * persona slot in between those and the output contract, and the sandwich is
 * already shaped for them.
 */
export function composeSystemPrompt(inputs: ComposeInputs = {}): ComposedPrompt {
  const setting = asSetting(inputs.setting);
  const profile = SETTING_PROFILES[setting];

  // Identity, then the setting, then HOW FORTHCOMING the setting allows, then
  // the wire format. The proactivity stanza sits after the setting so it can
  // refine the setting's "a pause is thinking" line rather than be overruled
  // by it, and before the contract so the contract still has the last word.
  const prompt = [
    inputs.base ?? SYSTEM_PROMPT,
    profile.stanza,
    PROACTIVITY_STANZAS[profile.proactivity],
    OUTPUT_CONTRACT,
  ].join("\n\n");

  return {
    prompt,
    setting,
    proactivity: profile.proactivity,
    maxReplyWords: profile.maxReplyWords,
    displayAllowed: profile.displayAllowed,
  };
}
