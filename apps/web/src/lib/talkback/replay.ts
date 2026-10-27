import {
  EMPTY_CONVERSATION,
  applyMessage,
  type Conversation,
  type ConversationMessage,
} from "./conversation";

/**
 * A conversation read back from storage, as the same `Conversation` the live
 * screen holds — so a past conversation is shown by the very views that
 * showed it live, and can be continued from where it was left.
 *
 * WHAT IS STORED. Both sides' lines on the drive's clock (`loadDriveLines`),
 * the visits to each subject (`loadSubjectVisits`: when the talk turned to
 * it, by ordinal and title), and what the recorder worked out per subject
 * (`subject_signal`: settled, kept). Replaying them in time order — a subject's
 * title as its visit starts, each line as it was said — through the same fold
 * the container's messages go through (`applyMessage`) gives the conversation
 * back without a second model of it.
 *
 * A CONTINUED CONVERSATION is several drives (`capture_session.continues_id`):
 * each drive's record is laid after the last one's on one clock, with a
 * `continued` mark where the next drive picked it up.
 *
 * Pure. The lines are the ledger's transcription, not the live one: they can
 * differ in wording from what was on screen during the drive.
 */

export interface RecordLine {
  who: "user" | "agent";
  /** ms into its drive. */
  startMs: number;
  endMs: number;
  text: string;
}

export interface RecordVisit {
  ordinal: number;
  title: string;
  /** ms into its drive. */
  startMs: number;
}

export interface RecordSubject {
  ordinal: number;
  settled: boolean | null;
  kept: boolean;
}

/** A draft the assistant wrote during the drive: a line in the chat where it was written. */
export interface RecordDraft {
  /** The draft's lineage id. */
  draftId: string;
  /** Which of the assistant's attempts its current version is (`draftMajor`). */
  major: number;
  /** ms into its drive. */
  startMs: number;
}

/** One drive's record. */
export interface DriveRecord {
  lines: readonly RecordLine[];
  visits: readonly RecordVisit[];
  subjects?: readonly RecordSubject[];
  drafts?: readonly RecordDraft[];
}

/** The gap laid between one drive's last line and the next drive's first. */
const BETWEEN_DRIVES_MS = 1000;

/** The messages that rebuild one drive's conversation, each with its time on the conversation's clock. */
export function recordMessages(record: DriveRecord, offsetMs = 0): { at: number; message: ConversationMessage }[] {
  const events: { at: number; order: number; message: ConversationMessage }[] = [];
  // A title comes before a line said at the same moment: the line is under it.
  for (const visit of record.visits) {
    events.push({
      at: offsetMs + visit.startMs,
      order: 0,
      message: { type: "title", title: visit.title, ordinal: visit.ordinal },
    });
  }
  record.lines.forEach((line, i) => {
    const text = line.text.trim();
    if (!text) return;
    events.push({
      at: offsetMs + line.startMs,
      order: 1,
      message: { type: line.who, id: `r${offsetMs}:${i}`, text, at: offsetMs + line.startMs },
    });
  });
  // A draft after the lines said by then: it follows the turn that wrote it.
  for (const draft of record.drafts ?? []) {
    events.push({
      at: offsetMs + draft.startMs,
      order: 2,
      message: { type: "mark", mark: { kind: "draft", draftId: draft.draftId, major: draft.major } },
    });
  }
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const subject of record.subjects ?? []) {
    const at = events.at(-1)?.at ?? offsetMs;
    if (subject.settled !== null) {
      events.push({ at, order: 3, message: { type: "state", ordinal: subject.ordinal, settled: subject.settled } });
    }
    if (subject.kept) {
      events.push({ at, order: 3, message: { type: "keep", ordinal: subject.ordinal, kept: true, via: "tap" } });
    }
  }
  return events.map(({ at, message }) => ({ at, message }));
}

/** When a drive's record ends, on its own clock. */
function recordEnd(record: DriveRecord): number {
  return record.lines.reduce((end, line) => Math.max(end, line.endMs), 0);
}

/**
 * One or more drives, in order, as one conversation. The first is the
 * conversation as it began; each later one continued it.
 */
export function replayConversation(drives: readonly DriveRecord[]): Conversation {
  let state = EMPTY_CONVERSATION;
  let offset = 0;
  drives.forEach((record, i) => {
    if (i > 0) state = applyMessage(state, { type: "mark", mark: { kind: "continued" } });
    for (const { at, message } of recordMessages(record, offset)) state = applyMessage(state, message, at);
    offset += recordEnd(record) + BETWEEN_DRIVES_MS;
  });
  return state;
}

/**
 * The messages that put a stored conversation into a live store, so a
 * continued drive starts with it on screen: the old turns, then the mark
 * where the new drive picks it up. Turn ids are prefixed so they can never
 * meet the container's.
 */
export function seedMessages(conversation: Conversation): ConversationMessage[] {
  const turns = conversation.sections
    .flatMap((section) => section.turns.map((turn) => ({ section, turn })))
    .sort((a, b) => a.turn.seq - b.turn.seq);
  const messages: ConversationMessage[] = [];
  let current: string | null = null;
  for (const { section, turn } of turns) {
    if (section.title !== null && section.key !== current) {
      messages.push({ type: "title", title: section.title, ...(section.ordinal ? { ordinal: section.ordinal } : {}) });
    }
    current = section.key;
    messages.push({
      type: turn.who,
      id: `past:${turn.seq}`,
      text: turn.text,
      ...(turn.at !== undefined ? { at: turn.at } : {}),
    });
  }
  for (const section of conversation.sections) {
    if (section.ordinal === undefined) continue;
    if (section.settled !== undefined) messages.push({ type: "state", ordinal: section.ordinal, settled: section.settled });
    if (section.kept) messages.push({ type: "keep", ordinal: section.ordinal, kept: true, via: section.kept.via });
  }
  if (turns.length > 0) messages.push({ type: "mark", mark: { kind: "continued" } });
  return messages;
}
