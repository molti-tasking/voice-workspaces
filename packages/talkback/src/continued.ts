/**
 * What the agent is told when a drive continues a past conversation
 * (`capture_session.continues_id`): that it is being picked up, the topics it
 * had, and the last of what was said — so "where were we?" and "the second
 * one" mean what they meant when the conversation stopped.
 *
 * Sent as a thread (`threads` in the context route), which the container puts
 * under "Where things stand", ahead of the quotes from other drives: this is
 * the same conversation, not an earlier one.
 *
 * Pure, and bounded: the newest lines are kept, the oldest dropped first.
 */

export interface ContinuedLine {
  who: "user" | "agent";
  text: string;
}

export interface ContinuedConversation {
  /** Its topics' titles, in the order they first came up. */
  topics: string[];
  /** Everything said in it, in order, across all its drives so far. */
  lines: ContinuedLine[];
  /** When it was last talked about, rendered for them ("yesterday, 18:40"). */
  when: string | null;
}

/** At most this many characters of earlier lines. */
export const CONTINUED_MAX_CHARS = 3000;
const MAX_LINE_CHARS = 300;

export function renderContinued(conversation: ContinuedConversation): string | null {
  if (conversation.lines.length === 0) return null;
  const kept: string[] = [];
  let used = 0;
  for (let i = conversation.lines.length - 1; i >= 0; i--) {
    const line = conversation.lines[i]!;
    const text = line.text.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
    if (!text) continue;
    const rendered = `${line.who === "agent" ? "You" : "They"}: ${text}`;
    if (used + rendered.length > CONTINUED_MAX_CHARS) break;
    kept.unshift(rendered);
    used += rendered.length + 1;
  }
  const dropped = conversation.lines.length - kept.length;
  return [
    `THIS DRIVE CONTINUES AN EARLIER CONVERSATION${conversation.when ? ` (last talked about ${conversation.when})` : ""}: they chose to pick it up where it was left, and its lines are on their screen above the new ones. Carry on from where it stopped; do not start over or recap unless asked.`,
    conversation.topics.length > 0 ? `Its topics, in order: ${conversation.topics.join("; ")}.` : null,
    dropped > 0 ? `Its last ${kept.length} lines (${dropped} earlier ones left out):` : "What was said:",
    ...kept,
  ]
    .filter(Boolean)
    .join("\n");
}
