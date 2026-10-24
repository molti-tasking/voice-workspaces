import type { Conversation, Section, Turn } from "./conversation";

/**
 * Going back in time through a conversation, the same way for every view.
 *
 * A CURSOR IS A TURN. Not a clock: a live conversation has no clock the
 * screen trusts, a stored one has the drive's, a scripted one has none — but
 * every turn of every one has a `seq`, its place in the order things were
 * said. The cursor is the `seq` of the last turn to show; null is "now", the
 * whole conversation, following it as it grows.
 *
 * `atCursor` cuts the conversation back to what had been said by then, as a
 * Conversation, so every view draws the past exactly as it drew the present:
 * the topics that had come up, the one being talked about then, the drafts and
 * sparks up to that point. Pure, and cheap enough to run on every drag.
 */

/** Every turn in the order it was said. */
export function turnsInOrder(conversation: Conversation): Turn[] {
  return conversation.sections.flatMap((section) => section.turns).sort((a, b) => a.seq - b.seq);
}

/** The conversation as it stood once turn `cursor` had been said; the whole of it for null. */
export function atCursor(conversation: Conversation, cursor: number | null): Conversation {
  if (cursor === null) return conversation;
  let current: Section | null = null;
  let latest = -1;
  const sections: Section[] = [];
  for (const section of conversation.sections) {
    const turns = section.turns.filter((t) => t.seq <= cursor);
    if (turns.length === 0) continue;
    const last = turns.at(-1)!.seq;
    if (last > latest) {
      latest = last;
      current = section;
    }
    sections.push(turns.length === section.turns.length ? section : { ...section, turns });
  }
  const unchanged =
    sections.length === conversation.sections.length &&
    sections.every((s, i) => s === conversation.sections[i]) &&
    conversation.marks.every((m) => m.after <= cursor);
  if (unchanged) return conversation;
  return {
    ...conversation,
    sections,
    current: current?.key ?? null,
    marks: conversation.marks.filter((m) => m.after <= cursor),
  };
}

/** The `seq` of the last turn said, or null before anything was. */
export function lastSeq(conversation: Conversation): number | null {
  let last: number | null = null;
  for (const section of conversation.sections) {
    for (const turn of section.turns) if (last === null || turn.seq > last) last = turn.seq;
  }
  return last;
}

/** Where a turn sits, for the time bar's label: its topic's title, and its time when known. */
export function cursorLabel(conversation: Conversation, cursor: number): { title: string | null; at: number | null } {
  for (const section of conversation.sections) {
    const turn = section.turns.find((t) => t.seq === cursor);
    if (turn) return { title: section.title, at: turn.at ?? null };
  }
  return { title: null, at: null };
}
