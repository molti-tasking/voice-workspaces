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

This is automatic transcription of unrehearsed speech, so it contains mistakes and half-finished sentences. If the speech is too fragmentary to name anything, return the current title unchanged, or NONE if there is no current title.

Return only the title, on one line, and nothing else.`;
