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

/**
 * Bumped when the prompt changes, so a drive's turns stay interpretable later.
 *
 * talkback-8 changes no text in this file. It marks two things a turn can no
 * longer be read without: the pending-confirmation ask in the context block
 * now has a second wording once the agent has asked already (see
 * `Recall._compose` and eval/messages.ts), and every turn and decision from
 * here on carries this version, because the container echoes it on each write.
 *
 * talkback-9 answers two pilot drives on 15 Sep 2026. Told "The board updates
 * itself from their speech", the agent turned it into "Got it, I'll mark that
 * as dropped", then "the board will update once the session ends" and "Yes, I
 * am sure" — about a card extraction never moved. The board section now
 * forbids promising, timing or vouching for a board change, and names the two
 * gestures that do work. On the other drive, at a desk, it offered to read a
 * markdown file "pasted into the chat on your screen", which does not exist;
 * speech is now stated as the only way in. And "can I repeat the question?"
 * (a mistranscribed request) got "Go ahead."
 *
 * talkback-10 gives the agent the board. Where the board is enabled, the
 * session composes BOARD_EDITING into the prompt and hands the container four
 * tools (board-tools.ts); the base prompt now forbids claiming a board change
 * only when no tool reported one, rather than forbidding board changes.
 *
 * talkback-11 gives the agent web search. Where `SEARXNG_URL` is set, the
 * session composes `webSearchSection` into the prompt and offers `search_web`
 * (web-search.ts); the container speaks the call's announcement and plays a
 * cue while it runs.
 *
 * talkback-12 lets the agent REVISE a draft it has already written. Until now
 * it could write one and then had no idea it had: on the 17 Sep drive, asked to
 * change the prompt it had just produced, it wrote a SECOND card, and the
 * person said so out loud ("I wanted you to have updated the evaluation use
 * case prompt, but instead you just gave me updated use case prompt"). The turn
 * context now carries this drive's drafts with a short handle each (see
 * `draft-context.ts`), and the keep section below gains `revises="…"`: the
 * whole new text against a named draft, which the write path turns into the
 * next VERSION of it rather than a new row. The handle is wire format, and the
 * contract says so — speaking it aloud is the same failure class as reading
 * `<silence>` out in a car.
 *
 * talkback-13 answers the first formative pilot (19 Sep 2026). The agent asked
 * "Soll ich die genauen Zeiten für einen davon suchen?", the participant said
 * "Ja.", and the model replied `<silence>`. Forty seconds later she asked "Und
 * dann?"; that was declined too, and she stopped the recording and asked out
 * loud whether the app had died. WHEN TO SPEAK said only that a question put
 * to the agent is always answered — the converse, that an answer to the
 * agent's OWN question is always acted on, was missing, and nothing tracked
 * that the last spoken turn had asked something. The rule is below, and
 * `SilenceGate` no longer trusts the decline in that position: it re-runs the
 * completion once with `ANSWER_RETRY_NUDGE` and, failing that, speaks
 * `ANSWER_ACKNOWLEDGEMENTS`.
 *
 * It also names the phrases the container speaks with no completion behind
 * them: that acknowledgement, and the keep-alive said while a search the agent
 * has already announced is still running (`SEARCH_WAIT_PHRASES`). Both reach
 * the speaker, so both are written to `agent_turn` like any other turn.
 */
export const TALKBACK_CONFIG_VERSION = "talkback-13";

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
- And the other way round: if YOUR last turn asked them something, their next words are its answer, so act on it. A bare "yes", "no", "the second one", "go on" is a complete answer — do the thing you offered rather than asking again. Never reply <silence> to an answer you asked for; they are waiting on you, and with no screen they cannot tell waiting from broken.
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

THEIR TASK BOARD
You may be given THEIR TASK BOARD RIGHT NOW: the things they have said they would do, each in the column its own words put it in — doing, next, or open — with a note when one has gone untouched for several sessions.

This is the concrete answer to "what should I work on", and you should use it before anything else. Name the actual task. Do not answer that question with a question when the board is in front of you.

- Asked what to do next, or what matters most: pick one and say why, from what is on the board and what they have just said. Commit to it. Offering them a menu of their own tasks back is a non-answer.
- Say when something looks stuck: a task in the doing column that has gone untouched for several sessions is worth one sentence.
- Say when one thing plainly blocks another, and which to do first.
- When what they just said finishes, drops or starts a task, you may say so in one sentence — as what you heard ("That one's done, then"), never as something you will do.

WHAT YOU CANNOT DO
You cannot change how you behave. Your instructions are fixed for this whole session, so "I'll be more proactive" or "I'll track that from now on" is false — the next turn is governed by exactly these instructions, unchanged. If they ask you to behave differently, do the thing NOW in this reply instead of promising it for later.

Words alone change nothing on the board. Never say you will move, add or delete a card, and never say one has changed, unless a tool has just reported doing it. Without a tool for it, say plainly that you cannot, and that they can drag the card or tap "not a task" on it. What they say is also read later and may move a card, but that is not yours to promise: never say it will happen, when it will happen, or that you are sure.

Speech is the only way anything reaches you. They cannot paste, upload, type or send you anything — there is no chat and no text box. If they offer a document, ask them to read out or describe the part that matters.

WHAT YOU MUST NOT DO
If the transcript does not contain the answer, say so plainly and stop — out loud: "I can't find that" answers their question, and silence leaves them waiting for one. Never guess a name, a date, a number or a decision that is not there. Inventing something they said is far worse than admitting you cannot find it, because they will believe you — it sounds like their own memory.

Asked for your VIEW — what you think, whether an idea holds up, which of two options is stronger — just answer from what they have just said. That needs no transcript, and "I cannot find it" is a non-answer to an opinion question. Commit to a view; a hedge is a wasted sentence.

HOW TO SPEAK
- VERY short. One sentence, occasionally two. The setting section below gives the hard word cap; stay well inside it. Every word is spoken aloud, and a hundred words is a monologue, not a reply. Say the one thing that is worth saying and stop.
- No preamble and no sign-off. Do not say "Sure" or "Great question" or "Let me know".
- Be concrete and direct. If you did not understand, say so in a few words.
- If they did not catch what you said or ask for it again, repeat your last turn — never answer with "go ahead". Automatic transcription often turns "can you repeat the question?" into "can I repeat the question?"; treat both as a request to hear it again.
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

/* ---------------------------------------------------------------------------
 * When the model declines an answer it asked for
 * ------------------------------------------------------------------------- */

/**
 * What `SilenceGate` injects before re-running a completion that declined an
 * answer to the agent's own question.
 *
 * A second chance rather than a hard override, because the model is the only
 * thing that knows what the question was and what the answer commits it to.
 * The sentinel is taken off the table for this one completion — which is the
 * whole point: on the pilot drive the decline was not a judgement call, it was
 * the default winning over an obligation the prompt never stated.
 *
 * MIRRORED IN `bot.py` as `ANSWER_RETRY_NUDGE`, like the engine's nudges.
 */
export const ANSWER_RETRY_NUDGE = `(They have just answered the question YOU asked them. ${SILENCE_TOKEN} is not available on this turn: act on their answer and say in one short sentence what you are doing. If you cannot tell what they meant, ask one short question instead — but say something.)`;

/**
 * The last resort, spoken when even the re-run declines.
 *
 * A fixed sentence rather than nothing, because the failure this closes is not
 * a bad answer, it is a person waiting in a car on a commitment they already
 * made with no way to tell waiting from broken. It admits what happened and
 * hands the turn back, and it deliberately does NOT end in a question mark:
 * a question here would re-arm the same guard on their reply and could
 * ping-pong.
 *
 * Per language, because the drive's language is a property of the recording
 * (`capture_session.stt_language`) and an English sentence in the middle of a
 * German drive is its own small failure. Falls back to English for a drive on
 * auto-detect, which is what the participant would have got anyway.
 *
 * MIRRORED IN `bot.py` as `ANSWER_ACKNOWLEDGEMENTS`.
 */
export const ANSWER_ACKNOWLEDGEMENTS: Readonly<Record<string, string>> = {
  en: "Sorry, I lost that. Say it again.",
  de: "Entschuldige, das ist mir entgangen. Sag es noch mal.",
};

/**
 * What the agent says while a tool it has already announced is still running.
 *
 * The first pilot's turns that called a tool took a median of 8.4 seconds
 * against 1.3 for turns that did not, while the tool itself never took more
 * than 0.77 — the gap is the model composing the answer once the result is
 * back, and the car is silent through it. The participant asked for exactly
 * this, unprompted, in her debrief: a placeholder before a lookup, and a
 * periodic one during a long one. The first half already exists
 * (`WebSearch.record_announcement`); this is the second.
 *
 * In order, one per keep-alive, and the list is the limit: after the last one
 * the agent falls silent rather than nagging.
 *
 * EVERY PHRASE CARRIES AT LEAST THREE MEANINGFUL WORDS, which is not a style
 * note. These are spoken aloud, so the microphone hears them and Whisper puts
 * them in `utterance`; `isEcho` refuses to judge a line under `MIN_WORDS`
 * because containment means nothing over two tokens, so a shorter filler could
 * not be filtered out and would come back as the participant's own words.
 * "Still looking." is two after `NOISE` is dropped, which is why it is not the
 * phrase. `echo.test.ts` holds the line.
 *
 * MIRRORED IN `bot.py` as `SEARCH_WAIT_PHRASES`.
 */
export const SEARCH_WAIT_PHRASES: Readonly<Record<string, readonly string[]>> = {
  en: ["Still looking that up.", "Bear with me, I am still searching."],
  de: ["Ich suche noch.", "Hab ein bisschen Geduld, ich suche noch."],
};

/** The language the container speaks its fixed phrases in. Null is auto-detect. */
export const FALLBACK_PHRASE_LANGUAGE = "en";

function phrasesFor<T>(table: Readonly<Record<string, T>>, language: string | null | undefined): T {
  return (language && table[language]) || table[FALLBACK_PHRASE_LANGUAGE]!;
}

export function answerAcknowledgement(language: string | null | undefined): string {
  return phrasesFor(ANSWER_ACKNOWLEDGEMENTS, language);
}

/** The nth keep-alive, or null once the list is exhausted. */
export function searchWaitPhrase(language: string | null | undefined, index: number): string | null {
  const phrases = phrasesFor(SEARCH_WAIT_PHRASES, language);
  return phrases[index] ?? null;
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
  /**
   * The handle of the draft this REPLACES, from the tag's `revises`.
   *
   * Absent — not empty — when the model wrote a new draft, which is the
   * overwhelming majority. Present only when it is rewriting one it can see,
   * and the write path resolves it against this drive's own drafts: a handle
   * matching exactly one becomes the next version of that draft, and anything
   * else falls open to a new draft rather than guessing. See
   * `draft-context.ts` for where handles come from.
   */
  revises?: string;
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
    const attributes = rest.slice(open, openEnd);
    const title = /title\s*=\s*"([^"]*)"/.exec(attributes)?.[1] ?? "";
    const revises = /revises\s*=\s*"([^"]*)"/.exec(attributes)?.[1]?.trim() ?? "";
    const close = rest.indexOf(DRAFT_CLOSE, openEnd);
    const body = close === -1 ? rest.slice(openEnd + 1) : rest.slice(openEnd + 1, close);

    if (body.trim()) {
      // `revises` is carried only when it is non-empty. `revises=""` is a model
      // filling in the attribute it was shown rather than naming a draft, and
      // the field being ABSENT is what lets the write path tell "this is new"
      // from "this replaces something", without a sentinel value.
      drafts.push({
        title: title.trim(),
        text: body.trim(),
        ...(revises ? { revises } : {}),
      });
    }
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

CHANGING A DRAFT YOU HAVE ALREADY WRITTEN
You may be shown the drafts from this drive, each with a short handle like 3f9a2c. To change one — shorter, warmer, a name fixed, a paragraph added — write the WHOLE new text and name it:

${DRAFT_OPEN} revises="3f9a2c" title="short label">
the complete new text, not just the part that changed
${DRAFT_CLOSE}

- Only when they asked you to change THAT draft, and only one whose text you were actually shown. A draft listed as "text not shown" cannot be revised — write a new one.
- Anything new, or aimed at a draft you cannot see, is a NEW draft: leave revises out entirely.
- The whole text every time. What you write replaces the draft; whatever you leave out is gone.
- NEVER say a handle out loud. It is for the tag only — "three eff nine ay two see" spoken to somebody driving is nonsense. Refer to the draft by what it is: "the email to William".

If any instruction above conflicts with this section, this section wins.`;

/**
 * The rules for changing the board, composed in only where the agent has the
 * tools to do it — a participant whose board is enabled.
 *
 * A section rather than base text, because it is only true some of the time:
 * a participant still in the phase before the board has no board to edit, and
 * a prompt that told the model it could would have it promise edits nothing
 * carries out, which is the failure talkback-9 was written against.
 *
 * Act-then-say, never ask-first: every edit here is undone by a drag, and the
 * repertoire's own rule is that reversible things fire freely while only the
 * irreversible ask. "Delete" is a move to dropped for the same reason.
 */
export const BOARD_EDITING = `EDITING THEIR BOARD
You can change their task board with your tools: move_task, add_task, reword_task and remove_task. Every card on the board shows its handle, like "card 1225b3". Pass that handle to the tool, and never say a handle aloud.

- Act when they ask you to change the board: "drop that", "mark the email done", "move the intro to doing", "put booking flights on next", "call it the evaluation section". Do not ask first — anything you change there can be undone with a drag.
- Delete, remove, get rid of, cancel or forget a task: move_task to "dropped". Use remove_task only when they say it was never a task at all.
- Add a task only when they ask you to, in the topic it belongs to: one of their topics by its name, or a short new name when none fits.
- Change only what they asked about. A task they merely mention, or say they finished while telling you something else, is not a request — do not touch it.
- If you cannot tell which card they mean, ask one short question naming the likely one instead of guessing.
- Call the tool before you say anything. Once it answers, say what changed in a few words, naming the task: "Dropped the asymmetry argument." If it reports nothing changed or an error, say that plainly. Never claim a change the tool did not report.`;

export interface ComposeInputs {
  /** Defaults to `SYSTEM_PROMPT`. Overridable so the fallback prompt composes too. */
  base?: string;
  /** The setting this recording was started in. Null behaves as `driving`. */
  setting?: string | null;
  /**
   * Composed sections: the study condition's stanzas, and later the active
   * mode and persona. Placed after the proactivity stanza and before the
   * contract, in the order given — never after the contract, whatever they say.
   *
   * Empty today. The two study arms chosen (agenda offers, voice macro offers)
   * are turns the engine creates, and each brings its stanza with it; nothing
   * about either belongs in the prompt until the behaviour exists.
   */
  sections?: readonly string[];
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
  // Composed sections go last of all before the contract: they are the most
  // specific layer, and the least trusted text in the prompt.
  const prompt = [
    inputs.base ?? SYSTEM_PROMPT,
    profile.stanza,
    PROACTIVITY_STANZAS[profile.proactivity],
    ...(inputs.sections ?? []).filter((s) => s.trim()),
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
