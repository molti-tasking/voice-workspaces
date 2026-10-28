/**
 * The live conversation the recorder shows: both sides of every turn, filed by
 * subject, and in the order they were said.
 *
 * WHY SECTIONS. Every subject is one section, in the order it first came up;
 * when the conversation goes back to one, its section becomes current again
 * and the new turns land under what was said before. Everything that judges a
 * subject reads them — the signals, the sparks, keeping, the reconnect titles.
 *
 * WHY ALSO AN ORDER (talkback-23). The screen used to show the sections
 * themselves, in two panels, and a return to a subject put the newest lines
 * twenty minutes up: "the sequence is not clear because it's going left,
 * right" (drive of 20 Oct 2026). So every turn also gets a `seq` in the order
 * it first arrived, and `timeline` lays the drive out as runs — one stretch of
 * talk on one subject each — which is what the screen shows. A return is a new
 * run at the bottom, never an insertion higher up.
 *
 * WHAT DECIDES THE SUBJECT is the container's topic title (`TopicTitle` in
 * apps/pipecat/bot.py), which is shown its earlier titles and returns one
 * verbatim on a return — so a section is found by its title, ignoring case,
 * and nothing here has to judge whether two subjects are the same.
 *
 * Pure, and kept out of React: the container pushes a message every few
 * hundred milliseconds while the agent talks, and `createConversationStore`
 * lets the screen subscribe to that without re-rendering everything else that
 * reads the capture context.
 *
 * Held in memory only, like the title before it. A reload mid-drive starts
 * empty — the durable record is `utterance` and `agent_turn`, on
 * `/sessions/[id]`.
 */

// Type-only, as in `signals.ts`: nothing of the package reaches the browser.
import type { SparkKind } from "@voicemural/talkback";

export type Speaker = "user" | "agent";

export interface Turn {
  /** The container's id, unique per connection. */
  id: string;
  /**
   * Its place in the drive: the order it FIRST arrived in, across both
   * speakers and every reconnect. Set once, and kept when the turn streams on
   * or is rehomed — ids restart on a reconnect, so they cannot order anything.
   */
  seq: number;
  who: Speaker;
  /** The whole turn so far: each message replaces the last. */
  text: string;
  /** The agent was cut off: they talked over it, or locked it. */
  interrupted?: boolean;
  /**
   * Their pauses of two seconds or more inside this turn, as the container's
   * VAD timed them (`PauseMarker`). Absent from an older container.
   */
  pauses?: number;
  /** Of those, the ones before the turn began: thinking before speaking. */
  pausesBefore?: number;
  /**
   * When it was said, in ms on the conversation's own clock — known for a
   * conversation read back from storage (`replay.ts`), where it labels the
   * time bar. Absent live.
   */
  at?: number;
}

export interface Section {
  /** The title folded for matching, or "" for talk before anything was named. */
  key: string;
  title: string | null;
  turns: Turn[];
  /**
   * The subject's number in the order it first came up in this drive: the
   * container's, from the title message, or the next free one if an older
   * container sent none. The only name for a subject that ever leaves the
   * participant's account (the sparks' `s{ordinal}`); titles never do.
   */
  ordinal?: number;
  /** How many times it has been the current subject, counting the first. */
  visits?: number;
  /**
   * When it was first and last talked about, as epoch ms. Stamped by the
   * store from the clock, so the reducer itself stays pure; `signals.ts`
   * reads them to tell a fading subject from a fresh one.
   */
  firstAt?: number;
  lastAt?: number;
  /**
   * Whether they stated a decision or a next step on it, as the container
   * judged when the subject was left. Absent until then.
   */
  settled?: boolean;
  /**
   * The `seq` of the last turn said when `settled` was judged, so going back
   * in time (`atCursor`) does not show a subject as settled before it was.
   */
  settledAfter?: number;
  /**
   * They KEPT it: marked it as theirs to hold in their own head, by a tap on
   * the subject or by saying "keep this one" (`keepRequest` in
   * @voicemural/shared). Absent means Souffleur holds it. With
   * `sparkSelection: "chosen"`, sparks are offered on kept subjects only.
   */
  kept?: { via: KeepVia; at: number; /** The `seq` of the last turn said when they kept it. */ after?: number };
}

/** How a subject was kept: a tap on it, or saying so. */
export type KeepVia = "tap" | "voice";

/**
 * Something that happened in the conversation that is not a turn: a draft the
 * agent wrote, or a spark they pulled. Placed after the turn it followed, so
 * the screen shows it where it happened; never counted as anybody's words.
 *
 * Kept in the store rather than in the screen because the recorder unmounts
 * when they walk to another page and back, and the store does not: a draft
 * placed by the screen would move to the end on every return.
 */
export type Mark =
  | {
      /** `draft:{lineage}:{major}`: one line per version the agent wrote. */
      key: string;
      kind: "draft";
      /** The draft's lineage id, as the cue stream carries it. */
      draftId: string;
      /** 1 for the first version, 2 for the agent's first rewrite, and so on. */
      major: number;
      /** The `seq` of the turn it follows; -1 before any turn. */
      after: number;
    }
  | {
      /** `spark:{ordinal}`: a subject's spark is pulled once per drive. */
      key: string;
      kind: "spark";
      ordinal: number;
      spark: SparkKind;
      /** The question as written for this subject, when there was one. */
      question?: string;
      after: number;
    }
  | {
      /**
       * `continued:{after}`: the conversation was picked up again here, on a
       * later drive (`/record?continue=`). Everything before it was said then.
       */
      key: string;
      kind: "continued";
      after: number;
    }
  | {
      /**
       * `lookup:{id}`: the agent searched for something, `id` being the tool
       * call's. The query as the agent sent it, so they can see what was
       * looked up; `found` once the result is back, null while it runs.
       */
      key: string;
      kind: "lookup";
      id: string;
      query: string;
      found: string | null;
      after: number;
    };

/** A mark as the recorder hands it in; the store places it. */
export type MarkInput =
  | { kind: "draft"; draftId: string; major: number }
  | { kind: "spark"; ordinal: number; spark: SparkKind; question?: string }
  | { kind: "continued" }
  /** Handed in twice: when the search starts, and again with `found` when it is back. */
  | { kind: "lookup"; id: string; query: string; found?: string };

export interface Conversation {
  /** In the order each subject first came up. */
  sections: Section[];
  /** The section new turns go into. Null before anything was said. */
  current: string | null;
  /**
   * Bumped each time an EARLIER section becomes current again. Nothing on the
   * screen reads it since the conversation became one column (talkback-23).
   */
  returns: number;
  /** The `seq` the next new turn gets. */
  nextSeq: number;
  /** Drafts and pulled sparks, in the order they happened. */
  marks: Mark[];
}

export const EMPTY_CONVERSATION: Conversation = {
  sections: [],
  current: null,
  returns: 0,
  nextSeq: 0,
  marks: [],
};

export type ConversationMessage =
  | {
      type: Speaker;
      id: string;
      text: string;
      interrupted?: boolean;
      pauses?: number;
      pausesBefore?: number;
      /** Only from storage (`replay.ts`): see `Turn.at`. */
      at?: number;
    }
  | { type: "title"; title: string; rehomeFrom?: string; ordinal?: number }
  /** What the container judged of a subject it has just left. */
  | { type: "state"; ordinal: number; settled: boolean }
  /**
   * They kept a subject, or took the keep back. Dispatched by the recorder
   * itself — from a tap, or from a turn it heard as "keep this one" — never
   * sent by the container, so `parseServerMessage` does not accept it.
   */
  | { type: "keep"; ordinal: number; kept: boolean; via: KeepVia }
  /**
   * A draft appeared, or they pulled a spark. Dispatched by the recorder,
   * never sent by the container.
   */
  | { type: "mark"; mark: MarkInput }
  /**
   * They renamed a subject. Dispatched by the recorder, never accepted from
   * the container: the container is TOLD of it, and names it by this title
   * from then on.
   */
  | { type: "rename"; ordinal: number; title: string };

/**
 * A server message from the container, checked.
 *
 * `serverMessage` is typed `any` by the client and carries whatever the
 * container pushed, so this is the boundary: an older container sends only
 * `{type: "title", title}`, and a future one may send kinds this does not know.
 */
export function parseServerMessage(data: unknown): ConversationMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type === "title") {
    if (typeof d.title !== "string" || !d.title.trim()) return null;
    return {
      type: "title",
      title: d.title.trim(),
      ...(typeof d.rehomeFrom === "string" ? { rehomeFrom: d.rehomeFrom } : {}),
      ...(Number.isInteger(d.ordinal) && (d.ordinal as number) > 0
        ? { ordinal: d.ordinal as number }
        : {}),
    };
  }
  if (d.type === "user" || d.type === "agent") {
    if (typeof d.id !== "string" || typeof d.text !== "string") return null;
    return {
      type: d.type,
      id: d.id,
      text: d.text,
      ...(d.interrupted === true ? { interrupted: true } : {}),
      ...(d.type === "user" && Number.isInteger(d.pauses) && (d.pauses as number) > 0
        ? { pauses: d.pauses as number }
        : {}),
      ...(d.type === "user" && Number.isInteger(d.pausesBefore) && (d.pausesBefore as number) > 0
        ? { pausesBefore: d.pausesBefore as number }
        : {}),
    };
  }
  if (d.type === "state") {
    if (!Number.isInteger(d.ordinal) || typeof d.settled !== "boolean") return null;
    return { type: "state", ordinal: d.ordinal as number, settled: d.settled };
  }
  return null;
}

/** How a title is matched to its section: case and spacing do not make a new subject. */
function sectionKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Fold one message into the conversation. Returns the same object when nothing changed.
 *
 * `at` is when it arrived, as epoch ms, for the sections' `firstAt` and
 * `lastAt`. Passed in rather than read here, so this stays a pure fold the
 * tests can replay; the store passes `Date.now()`.
 */
export function applyMessage(
  state: Conversation,
  message: ConversationMessage,
  at?: number,
): Conversation {
  if (message.type === "state") return applyState(state, message);
  if (message.type === "keep") return applyKeep(state, message, at ?? 0);
  if (message.type === "mark") return applyMark(state, message.mark);
  if (message.type === "rename") return applyRename(state, message);
  const next = message.type === "title" ? applyTitle(state, message) : applyTurn(state, message);
  if (next === state || at === undefined || next.current === null) return next;
  return {
    ...next,
    sections: next.sections.map((s) =>
      s.key !== next.current ? s : { ...s, firstAt: s.firstAt ?? at, lastAt: at },
    ),
  };
}

/** A judgement on a subject, filed by its ordinal. Not a touch: `lastAt` stays. */
function applyState(
  state: Conversation,
  message: Extract<ConversationMessage, { type: "state" }>,
): Conversation {
  const at = state.sections.findIndex((s) => s.ordinal === message.ordinal);
  if (at === -1 || state.sections[at]!.settled === message.settled) return state;
  const settledAfter = state.nextSeq - 1;
  return {
    ...state,
    sections: state.sections.map((s, i) => (i === at ? { ...s, settled: message.settled, settledAfter } : s)),
  };
}

/**
 * A keep, or taking one back, filed by ordinal. Not a touch: `lastAt` stays,
 * because deciding to keep a subject is not talking about it. Keeping a kept
 * subject again changes nothing — the first keep, and how it was made, stand.
 */
function applyKeep(
  state: Conversation,
  message: Extract<ConversationMessage, { type: "keep" }>,
  at: number,
): Conversation {
  const index = state.sections.findIndex((s) => s.ordinal === message.ordinal);
  if (index === -1) return state;
  const section = state.sections[index]!;
  if (message.kept === (section.kept !== undefined)) return state;
  const next: Section = message.kept
    ? { ...section, kept: { via: message.via, at, after: state.nextSeq - 1 } }
    : (({ kept: _kept, ...rest }) => rest)(section);
  return { ...state, sections: state.sections.map((s, i) => (i === index ? next : s)) };
}

/**
 * A draft or a pulled spark, placed after the turn it followed. Not a touch:
 * `lastAt` stays, as for a keep. The same mark again changes nothing, so the
 * recorder can hand in every draft it sees, every time it sees them.
 *
 * A draft follows the latest AGENT turn: it reaches the recorder through the
 * database a few seconds after the agent said it had written it, and by then
 * they may have started talking again. A spark follows whatever was said last,
 * because it is pulled the moment they tap.
 */
function applyMark(state: Conversation, input: MarkInput): Conversation {
  if (input.kind === "lookup") {
    // The second hand-in is the result: the search stays where it started.
    const key = `lookup:${input.id}`;
    const found = input.found ?? null;
    const existing = state.marks.find((m) => m.key === key);
    if (existing) {
      if (existing.kind !== "lookup" || found === null || existing.found === found) return state;
      return { ...state, marks: state.marks.map((m) => (m === existing ? { ...existing, found } : m)) };
    }
    const after = lastTurnSeq(state);
    return { ...state, marks: [...state.marks, { key, kind: "lookup", id: input.id, query: input.query, found, after }] };
  }
  let after = -1;
  for (const section of state.sections) {
    for (const turn of section.turns) {
      if (input.kind === "draft" && turn.who !== "agent") continue;
      after = Math.max(after, turn.seq);
    }
  }
  const key =
    input.kind === "draft"
      ? `draft:${input.draftId}:${input.major}`
      : input.kind === "spark"
        ? `spark:${input.ordinal}`
        : `continued:${after}`;
  if (state.marks.some((m) => m.key === key)) return state;
  return { ...state, marks: [...state.marks, { ...input, key, after } as Mark] };
}

/** The `seq` of the last turn said, by either of them; -1 before any. */
function lastTurnSeq(state: Conversation): number {
  let after = -1;
  for (const section of state.sections) for (const turn of section.turns) after = Math.max(after, turn.seq);
  return after;
}

/** The longest title a rename keeps: what the container keeps of a title it is handed. */
export const MAX_TITLE_CHARS = 64;

/** A title as they typed it, as it is kept: one line, trimmed, capped. */
export function cleanSubjectTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
}

/**
 * Their own name for a subject, in place of the one it was given
 * automatically. The key stays — it is how the container's messages about the
 * subject are matched, along with its ordinal — and so do the turns, the
 * signals and the keep. Not a touch: `lastAt` stays.
 *
 * Refused (the same state back) for an empty title, an unknown ordinal, or a
 * name another subject of this drive already has: the container files
 * subjects by name, and two of one name would become one.
 */
function applyRename(
  state: Conversation,
  message: Extract<ConversationMessage, { type: "rename" }>,
): Conversation {
  const title = cleanSubjectTitle(message.title);
  const index = state.sections.findIndex((s) => s.ordinal === message.ordinal);
  if (!title || index === -1 || state.sections[index]!.title === title) return state;
  const folded = sectionKey(title);
  const taken = state.sections.some(
    (s, i) => i !== index && (s.key === folded || (s.title !== null && sectionKey(s.title) === folded)),
  );
  if (taken) return state;
  return {
    ...state,
    sections: state.sections.map((s, i) => (i === index ? { ...s, title } : s)),
  };
}

/** The ordinal a new subject gets when the container did not send one. */
function nextOrdinal(sections: Section[]): number {
  return sections.reduce((max, s) => Math.max(max, s.ordinal ?? 0), 0) + 1;
}

function applyTurn(
  state: Conversation,
  message: Extract<ConversationMessage, { type: Speaker }>,
): Conversation {
  const turn: Turn = {
    id: message.id,
    seq: state.nextSeq,
    who: message.type,
    text: message.text,
    ...(message.interrupted ? { interrupted: true } : {}),
    ...(message.type === "user" && message.pauses ? { pauses: message.pauses } : {}),
    ...(message.type === "user" && message.pausesBefore
      ? { pausesBefore: message.pausesBefore }
      : {}),
    ...(message.at !== undefined ? { at: message.at } : {}),
  };

  // A turn already on screen is updated where it is, even if the subject has
  // moved on since: it was said under the old one.
  const at = state.sections.findIndex((s) => s.turns.some((t) => t.id === turn.id));
  if (at !== -1) {
    const sections = state.sections.map((section, i) =>
      i !== at
        ? section
        : {
            ...section,
            turns: section.turns.map((t) =>
              t.id !== turn.id
                ? t
                : { ...turn, seq: t.seq, interrupted: turn.interrupted || t.interrupted },
            ),
          },
    );
    return { ...state, sections };
  }

  // Talk before anything has been named sits in an untitled section, which
  // the first title then names.
  if (state.current === null) {
    return {
      ...state,
      sections: [...state.sections, { key: "", title: null, turns: [turn], visits: 1 }],
      current: "",
      nextSeq: state.nextSeq + 1,
    };
  }
  const sections = state.sections.map((section) =>
    section.key !== state.current ? section : { ...section, turns: [...section.turns, turn] },
  );
  return { ...state, sections, nextSeq: state.nextSeq + 1 };
}

function applyTitle(
  state: Conversation,
  message: Extract<ConversationMessage, { type: "title" }>,
): Conversation {
  const folded = sectionKey(message.title);
  if (!folded) return state;

  let sections = state.sections;
  // The subject by its ordinal first: once they rename one, the container
  // names it by THEIR title, which is not the key it was filed under. Then
  // by key, then by the title it shows, for a container that sends no ordinal.
  const existing =
    (message.ordinal !== undefined ? sections.find((s) => s.ordinal === message.ordinal) : undefined) ??
    sections.find((s) => s.key === folded) ??
    sections.find((s) => s.title !== null && sectionKey(s.title) === folded);
  const key = existing?.key ?? folded;
  if (key === state.current) return state;

  // The first title names whatever was said before it.
  if (state.current === "" && !existing) {
    return {
      ...state,
      sections: sections.map((s) =>
        s.key === ""
          ? { ...s, key, title: message.title, ordinal: message.ordinal ?? nextOrdinal(sections) }
          : s,
      ),
      current: key,
    };
  }

  // The turns that changed the subject go with it: from `rehomeFrom` on, out
  // of the section that was current and into the new one. Without this the
  // first sentences of every new subject sit under the old title, because
  // the title is named a few seconds after they were said.
  let moved: Turn[] = [];
  if (message.rehomeFrom && state.current !== null) {
    sections = sections.map((section) => {
      if (section.key !== state.current) return section;
      const from = section.turns.findIndex((t) => t.id === message.rehomeFrom);
      if (from === -1) return section;
      moved = section.turns.slice(from);
      return { ...section, turns: section.turns.slice(0, from) };
    });
  }

  if (existing) {
    sections = sections.map((s) =>
      s.key === key ? { ...s, turns: [...s.turns, ...moved], visits: (s.visits ?? 1) + 1 } : s,
    );
  } else {
    sections = [
      ...sections,
      {
        key,
        title: message.title,
        turns: moved,
        ordinal: message.ordinal ?? nextOrdinal(sections),
        visits: 1,
      },
    ];
  }
  // A section the move emptied said nothing under its title.
  sections = sections.filter((s) => s.turns.length > 0 || s.key === key);

  return {
    ...state,
    sections,
    current: key,
    returns: existing ? state.returns + 1 : state.returns,
  };
}

/**
 * Which of the agent's attempts a draft version is: `v2.1` is the agent's
 * second, edited once by hand. A hand edit is not a new line in the
 * conversation; a rewrite the agent was asked for is.
 */
export function draftMajor(version: string): number {
  const major = /^v(\d+)/.exec(version.trim())?.[1];
  return major ? Math.max(1, Number(major)) : 1;
}

/** One stretch of talk on one subject: what the screen puts under a headline. */
export interface Run {
  /**
   * `r{seq}` of its first turn, so it stays the same while the run grows and
   * when the untitled stretch is named; `now:{key}` for a subject named before
   * anything was said under it.
   */
  id: string;
  sectionKey: string;
  title: string | null;
  ordinal?: number;
  /** Its turns, in order, with the drafts and sparks that followed them. */
  items: ({ kind: "turn"; turn: Turn } | { kind: "mark"; mark: Mark })[];
  /** How many of the items are turns. */
  turns: number;
  /** An earlier run was on the same subject: the conversation came back to it. */
  isReturn: boolean;
  /** New turns go here. */
  current: boolean;
}

/**
 * The drive as the screen shows it: every turn in the order it first arrived,
 * cut into runs wherever the subject changes. A return to a subject is a new
 * run at the end, so nothing is ever inserted above what they are reading.
 *
 * A rehome needs nothing special: the moved turns keep their `seq`, so the new
 * subject's run starts just where the talk turned to it. A mark from before
 * the first turn it could follow (drafts already written when the page was
 * reloaded mid-drive) leads the first run.
 */
export function timeline(state: Conversation): Run[] {
  const sectionOf = new Map<number, Section>();
  const turns: Turn[] = [];
  for (const section of state.sections) {
    for (const turn of section.turns) {
      sectionOf.set(turn.seq, section);
      turns.push(turn);
    }
  }
  turns.sort((a, b) => a.seq - b.seq);

  const leading: Mark[] = [];
  const following = new Map<number, Mark[]>();
  for (const mark of state.marks) {
    if (!sectionOf.has(mark.after)) leading.push(mark);
    else following.set(mark.after, [...(following.get(mark.after) ?? []), mark]);
  }

  const runs: Run[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const section = sectionOf.get(turn.seq)!;
    let run = runs.at(-1);
    if (!run || run.sectionKey !== section.key) {
      run = {
        id: `r${turn.seq}`,
        sectionKey: section.key,
        title: section.title,
        ...(section.ordinal !== undefined ? { ordinal: section.ordinal } : {}),
        items: [],
        turns: 0,
        isReturn: seen.has(section.key),
        current: false,
      };
      seen.add(section.key);
      runs.push(run);
    }
    run.items.push({ kind: "turn", turn });
    run.turns += 1;
    for (const mark of following.get(turn.seq) ?? []) run.items.push({ kind: "mark", mark });
  }

  // Named, and nothing said under the name yet: the headline shows where the
  // talk is now.
  const current = state.sections.find((s) => s.key === state.current);
  const last = runs.at(-1);
  if (current && (!last || last.sectionKey !== current.key)) {
    runs.push({
      id: `now:${current.key}`,
      sectionKey: current.key,
      title: current.title,
      ...(current.ordinal !== undefined ? { ordinal: current.ordinal } : {}),
      items: [],
      turns: 0,
      isReturn: seen.has(current.key),
      current: false,
    });
  }
  const end = runs.at(-1);
  if (end && end.sectionKey === state.current) end.current = true;

  if (leading.length > 0) {
    if (runs.length === 0) {
      runs.push({ id: "start", sectionKey: "", title: null, items: [], turns: 0, isReturn: false, current: false });
    }
    runs[0]!.items.unshift(...leading.map((mark) => ({ kind: "mark" as const, mark })));
  }
  return runs;
}

/** The current subject's title, for the bar on other screens. */
export function currentTitle(state: Conversation): string | null {
  return state.sections.find((s) => s.key === state.current)?.title ?? null;
}

/**
 * The titles to hand the container on a reconnect, current one LAST — so a
 * subject from before the tunnel comes back under the name it already has,
 * and under the same ordinal, which the sparks and the stored subjects
 * (`drive_subject`) both key on.
 */
export function titlesForReconnect(state: Conversation): { title: string; ordinal?: number }[] {
  const named = state.sections.filter((s) => s.title !== null);
  const current = named.find((s) => s.key === state.current);
  return [...named.filter((s) => s !== current), ...(current ? [current] : [])].map((s) => ({
    title: s.title!,
    ...(s.ordinal !== undefined ? { ordinal: s.ordinal } : {}),
  }));
}

/**
 * The lines of this drive, in order, for a reconnecting agent. Not the lines
 * of a conversation it continues (`past:` ids, from `seedMessages`): those
 * reach the agent another way.
 */
export function linesForReconnect(state: Conversation): { id: string; who: Speaker; text: string }[] {
  return state.sections
    .flatMap((s) => s.turns)
    .filter((t) => !t.id.startsWith("past:") && t.text.trim())
    .sort((a, b) => a.seq - b.seq)
    .map(({ id, who, text }) => ({ id, who, text }));
}

export interface ConversationStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Conversation;
  dispatch(message: ConversationMessage): void;
}

/** One drive's conversation, as an external store for `useSyncExternalStore`. */
export function createConversationStore(): ConversationStore {
  let state = EMPTY_CONVERSATION;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    dispatch(message) {
      const next = applyMessage(state, message, Date.now());
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
