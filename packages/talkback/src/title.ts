/**
 * The live topic title: what the conversation is about RIGHT NOW.
 *
 * A departure board, not a transcript. The recorder used to show the last eight
 * turns of the exchange, which is a lot of text to put in front of somebody who
 * is driving — reading it is the one thing they cannot do. Two to four words
 * naming the subject can be taken in peripherally, in the time a glance costs.
 *
 * TWO LINES ARE LOAD-BEARING and should not be trimmed for brevity:
 *
 *   "If the speech is still about the current title, return it EXACTLY."
 *   — the board is only worth having if it is STILL most of the time. A model
 *   that rephrases the same subject every call turns the screen into a flicker,
 *   which is precisely the motion the recorder is designed to avoid. Returning
 *   the current title unchanged is how the title stays still, and it is
 *   also what makes the animation affordable: it fires when the subject
 *   genuinely changes, which is rare.
 *
 *   "the most specific subject … never a category"
 *   — "Work" and "Planning" are true of almost every drive and therefore say
 *   nothing. The proper noun or the concrete thing being decided is the only
 *   version of this that is worth a glance.
 *
 * AND ONE MORE, since the recorder files every turn under the title it was
 * said in (two panels, one section per subject):
 *
 *   "If the speech has gone back to one of those, return that earlier title
 *   EXACTLY"
 *   — a conversation comes back to things. Without the earlier titles in front
 *   of it the model names the return afresh ("TÜV appointment" becomes "Car
 *   inspection date"), the screen grows a second section for one subject, and
 *   the person scrolling back finds half of it in each. Returned verbatim, the
 *   browser recognises the title it already has a section for and scrolls back
 *   to it.
 *
 * Sent to the Python container in the `/api/realtime/session` response rather
 * than duplicated there, for the same reason as `SUMMARY_PROMPT`: one copy of
 * this text. The container calls it against a short window of recent speech —
 * not the whole-drive summary — because the question is what is being talked
 * about now, not what the drive has been about.
 */
export const TITLE_PROMPT = `You name what a live spoken conversation is about RIGHT NOW, as a title on a departure board.

Return 2-4 words naming the most specific subject in the recent speech: the proper noun, the concrete thing being decided, asked or worked out. Never a category — "Work", "Planning" and "Ideas" are true of every conversation and say nothing.

Never begin with "Discussing", "Thoughts on", "About" or any other framing. No punctuation, no quotes, no markdown. Use the language being spoken.

You are given the current title and the most recent speech. If the speech is still about the current title, return it EXACTLY as given — the board only changes when the subject does.

You may also be given the earlier titles of this conversation. If the speech has gone back to one of those subjects, return that earlier title EXACTLY as given, so the talk is filed with what was said about it before. Only for the same subject: a new subject gets a new title.

This is automatic transcription of unrehearsed speech, so it contains mistakes and half-finished sentences. If the speech is too fragmentary to name anything, return the current title unchanged, or NONE if there is no current title.

Return only the title, on one line, and nothing else.`;

/**
 * Whether a subject the conversation has just LEFT was settled: did the person
 * state a decision, a conclusion or a next step on it?
 *
 * One answer per subject left (`TopicTitle` in bot.py), on that subject's own
 * stretch of speech, and the recorder shows it as "settled" or "open" under the
 * subject (apps/web/src/lib/talkback/signals.ts). An open subject they have
 * talked through is what the `decide` spark is for.
 *
 * THEIRS, NOT THE AGENT'S. The window carries the agent's lines marked
 * "(you said)", and an agent that proposed a plan has not settled anything for
 * them: the question is whether THEY landed. Coarse on purpose, and lopsided
 * the safe way — when unsure, OPEN, because a spark offered on a subject that
 * was in fact settled costs a tap, and a subject wrongly marked settled is
 * never offered at all.
 *
 * Sent to the container in the `/api/realtime/session` response, like
 * `TITLE_PROMPT`: one copy of this text. Without it the container makes no
 * call and the browser never shows a mark.
 */
export const SETTLED_PROMPT = `You judge one subject of a live spoken conversation that has just moved on to something else.

You are given the subject's title and what was said about it. Lines starting "(you said)" are the assistant's; everything else is the person thinking aloud.

Answer SETTLED if the PERSON stated a decision, a conclusion or a concrete next step on this subject in their own words. A proposal from the assistant that they did not take up in their own words is not settled. Answer OPEN otherwise, and whenever you are unsure.

This is automatic transcription of unrehearsed speech, in any language. Return exactly one word: SETTLED or OPEN.`;

/*
 * The calls themselves, for an engine that has no container to make them
 * (`/api/realtime/topic`, for `use-realtime.ts`). Ported from `bot.py` —
 * `TopicTitle._name_once`, `_judge`, `clean_title`, `parse_settled` — with
 * the same messages, so a title is asked for the same way on either engine.
 */

/** The naming call's messages: the current title, the earlier ones, and the recent speech. */
export function titleMessages(
  current: string | null,
  earlier: readonly string[],
  recent: string,
): { role: "system" | "user"; content: string }[] {
  const earlierLine = earlier.length > 0 ? `Earlier titles: ${earlier.join("; ")}\n\n` : "";
  return [
    { role: "system", content: TITLE_PROMPT },
    { role: "user", content: `Current title: ${current ?? "(none yet)"}\n\n${earlierLine}Recent speech:\n${recent}` },
  ];
}

/** The settled check's messages: one subject, and what was said while it was current. */
export function settledMessages(title: string, said: string): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SETTLED_PROMPT },
    { role: "user", content: `Subject: ${title}\n\nWhat was said:\n${said}` },
  ];
}

const TRAILING_MARKS = /[\s.,;:!?\-–—]+$/u;

/**
 * Make a model's answer fit on a board, or decide it is not a change: null
 * for NONE, for nothing, and for the current title given back — which is the
 * common case, and the one the prompt asks for. Four words and 32 characters,
 * cut at a word.
 */
export function cleanTitle(raw: string | null | undefined, previous: string | null): string | null {
  if (!raw) return null;
  let text = raw.trim().replace(/[*_`#]+/g, " ");
  text = text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").trim();
  text = text.replace(TRAILING_MARKS, "").replace(/\s+/g, " ").trim();
  if (!text || text.toUpperCase() === "NONE") return null;
  const words = text.split(" ").slice(0, 4);
  while (words.length > 1 && words.join(" ").length > 32) words.pop();
  text = words.join(" ").slice(0, 32).trim().replace(TRAILING_MARKS, "");
  if (!text) return null;
  if (previous !== null && text.toLowerCase() === previous.toLowerCase()) return null;
  return text;
}

/** SETTLED or OPEN, however the model dressed it; null for anything else. */
export function parseSettled(raw: string | null | undefined): boolean | null {
  const first = (raw ?? "").trim().split(/\s+/)[0] ?? "";
  const word = first.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (word === "SETTLED") return true;
  if (word === "OPEN") return false;
  return null;
}
