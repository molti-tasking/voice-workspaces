import type { ChatMessage } from "@voicemural/llm";

/**
 * What the system is, and how it takes a turn.
 *
 * Phase 2 hard-codes this. From Phase 3 it is composed from the active mode and
 * persona's `capabilityVersion.markdown`, which is the paper's actual claim —
 * `mode` governing turn-taking and elicitation, `persona` governing register.
 * The shape here is deliberately the shape that composition will produce, so
 * swapping the source does not mean rewriting the caller.
 *
 * Pure: no I/O, no model call, fully testable.
 */

/** Bumped when the prompt changes, so a drive's turns stay interpretable later. */
export const TALKBACK_CONFIG_VERSION = "talkback-1";

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
export const SYSTEM_PROMPT = `You are a quiet companion riding along while someone drives and thinks aloud.

You are NOT an assistant and you are not here to be helpful in the usual way. Most of what you hear is someone working out a thought for themselves. That thinking is the point; you are not.

WHEN TO SPEAK
- A question put to you is ALWAYS answered. Never stay silent on a direct question, even a hard or open-ended one like "what do you think?".
- Answer when you are clearly being addressed.
- Otherwise say nothing at all. Reply with exactly: <silence>

Someone trailing off, repeating themselves, contradicting themselves or pausing mid-sentence is thinking, not waiting for you. Say <silence>.

WHAT YOU CAN SEE
Before each turn you may be given transcript from what they actually said — earlier in this drive, and from past recordings. It is their own words, transcribed automatically, so it contains mistakes and half-finished sentences.

Use it. When asked what they said, what they decided, or what has come up so far, answer from that transcript and say roughly when it was.

WHAT YOU MUST NOT DO
If the transcript does not contain the answer, say so plainly and stop. Never guess a name, a date, a number or a decision that is not there. Inventing something they said is far worse than admitting you cannot find it, because they will believe you — it sounds like their own memory.

Asked for your VIEW — what you think, whether an idea holds up, which of two options is stronger — just answer from what they have just said. That needs no transcript, and "I cannot find it" is a non-answer to an opinion question.

HOW TO SPEAK
- VERY short. One sentence, occasionally two. Under 25 words.
  Every word is spoken aloud to someone driving: 200 characters is fourteen
  seconds of talking, which is a monologue, not a reply. Say the one thing that
  is worth saying and stop.
- Plain speech. No markdown, no lists, no headings — every word is read aloud.
- No preamble and no sign-off. Do not say "Sure" or "Great question" or "Let me know".
- Ask at most one question, and only when a question genuinely moves the thought on.
- The driver cannot look at a screen or take notes. Do not offer to show anything.
- Be concrete. If you did not understand, say so plainly in a few words.
- Do not restate their question back to them, and do not explain what you cannot
  do at length. "I'd need more detail — what's pushing you toward cutting it?"
  not a paragraph about what you lack.`;

/** One side of the conversation so far. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * The marker the model emits instead of speaking.
 *
 * A sentinel rather than an empty reply because an empty completion is
 * indistinguishable from a failed one, and the difference matters: choosing not
 * to speak is a turn-taking decision worth recording, while a failure is a bug.
 */
export const SILENCE_TOKEN = "<silence>";

/**
 * How much conversation to carry.
 *
 * Short on purpose. Prompt processing dominates time-to-first-token on a
 * self-hosted model, and a drive is an hour long — carrying all of it would
 * make every turn slower than the last. The workspace is the long-term memory;
 * this is just the thread of the current exchange.
 */
const MAX_HISTORY_TURNS = 8;

/** Transcript put in front of the model for this turn. */
export interface RetrievedContext {
  /** What was said earlier in this same drive, oldest first. */
  driveSoFar: string[];
  /** Passages from past recordings, each already labelled with when it was. */
  fromThePast: { when: string; text: string }[];
}

/**
 * How much retrieved transcript to include.
 *
 * Prompt processing dominates time-to-first-token on a self-hosted model, so
 * this is a direct latency cost paid on every turn — and past a point more
 * context makes the answer worse, not better, by burying the relevant line.
 */
const MAX_CONTEXT_CHARS = 4000;

function trimToBudget(lines: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  // Backwards: the most recent lines are the ones worth keeping.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (used + line.length > budget) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept;
}

export function buildTurnPrompt(history: Turn[], context?: RetrievedContext): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const sections: string[] = [];

  if (context?.fromThePast.length) {
    sections.push(
      "From their past recordings:\n" +
        context.fromThePast.map((p) => `[${p.when}] ${p.text}`).join("\n\n"),
    );
  }

  if (context?.driveSoFar.length) {
    const lines = trimToBudget(context.driveSoFar, MAX_CONTEXT_CHARS / 2);
    if (lines.length) sections.push(`Earlier in this drive:\n${lines.join(" ")}`);
  }

  if (sections.length) {
    // A system message rather than a user one: it is reference material, not
    // something the driver said, and a model that mistakes the two starts
    // replying to the transcript instead of to the person.
    messages.push({
      role: "system",
      content: `${sections.join("\n\n")}\n\nThat transcript is background. Answer only what was just said to you.`,
    });
  }

  messages.push(
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.text,
    })),
  );

  return messages;
}

/**
 * Whether a completion means "say nothing".
 *
 * Tolerant of the ways a model dresses the sentinel up — surrounding
 * whitespace, a trailing full stop, a stray quotation mark. A missed sentinel
 * is the system reading the word "silence" aloud in a car, which is the single
 * most conspicuous way this could fail.
 */
export function isSilence(reply: string): boolean {
  const normalised = reply.trim().toLowerCase().replace(/[."'`*]/g, "");
  return normalised === SILENCE_TOKEN.replace(/[<>]/g, "") || normalised === SILENCE_TOKEN;
}

/**
 * Strip anything the model added around a real reply.
 *
 * Small models occasionally emit the sentinel AND a sentence, or wrap a reply in
 * quotes. Both are read aloud verbatim otherwise.
 */
export function cleanReply(reply: string): string {
  return reply
    .replaceAll(SILENCE_TOKEN, "")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .trim();
}
