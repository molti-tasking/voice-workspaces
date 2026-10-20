/**
 * The live conversation as the recorder's two panels show it: both sides of
 * every turn, filed by subject.
 *
 * WHY SECTIONS. The study has moved to who holds the floor, so the screen
 * shows the turns again — one panel for the agent, one for the person — but
 * not as a chat log. A drive wanders between subjects and comes back to them,
 * and a log puts the second half of a subject twenty minutes below its first.
 * Here every subject is one section, in the order it first came up; when the
 * conversation goes back to one, its section becomes current again and the new
 * turns land under what was said before. The panels scroll there.
 *
 * WHAT DECIDES THE SUBJECT is the container's topic title (`TopicTitle` in
 * apps/pipecat/bot.py), which is shown its earlier titles and returns one
 * verbatim on a return — so a section is found by its title, ignoring case,
 * and nothing here has to judge whether two subjects are the same.
 *
 * Pure, and kept out of React: the container pushes a message every few
 * hundred milliseconds while the agent talks, and `createConversationStore`
 * lets the panels subscribe to that without re-rendering everything else that
 * reads the capture context.
 *
 * Held in memory only, like the title before it. A reload mid-drive starts
 * empty — the durable record is `utterance` and `agent_turn`, on
 * `/sessions/[id]`.
 */

export type Speaker = "user" | "agent";

export interface Turn {
  /** The container's id, unique per connection. */
  id: string;
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
   * They KEPT it: marked it as theirs to hold in their own head, by a tap on
   * the subject or by saying "keep this one" (`keepRequest` in
   * @voicemural/shared). Absent means Souffleur holds it. With
   * `sparkSelection: "chosen"`, sparks are offered on kept subjects only.
   */
  kept?: { via: KeepVia; at: number };
}

/** How a subject was kept: a tap on it, or saying so. */
export type KeepVia = "tap" | "voice";

export interface Conversation {
  /** In the order each subject first came up. */
  sections: Section[];
  /** The section new turns go into. Null before anything was said. */
  current: string | null;
  /**
   * Bumped each time an EARLIER section becomes current again, so the panels
   * know to scroll back to it — the one move they make on their own besides
   * following the newest line.
   */
  returns: number;
}

export const EMPTY_CONVERSATION: Conversation = { sections: [], current: null, returns: 0 };

export type ConversationMessage =
  | {
      type: Speaker;
      id: string;
      text: string;
      interrupted?: boolean;
      pauses?: number;
      pausesBefore?: number;
    }
  | { type: "title"; title: string; rehomeFrom?: string; ordinal?: number }
  /** What the container judged of a subject it has just left. */
  | { type: "state"; ordinal: number; settled: boolean }
  /**
   * They kept a subject, or took the keep back. Dispatched by the recorder
   * itself — from a tap, or from a turn it heard as "keep this one" — never
   * sent by the container, so `parseServerMessage` does not accept it.
   */
  | { type: "keep"; ordinal: number; kept: boolean; via: KeepVia };

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
  return {
    ...state,
    sections: state.sections.map((s, i) => (i === at ? { ...s, settled: message.settled } : s)),
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
    ? { ...section, kept: { via: message.via, at } }
    : (({ kept: _kept, ...rest }) => rest)(section);
  return { ...state, sections: state.sections.map((s, i) => (i === index ? next : s)) };
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
    who: message.type,
    text: message.text,
    ...(message.interrupted ? { interrupted: true } : {}),
    ...(message.type === "user" && message.pauses ? { pauses: message.pauses } : {}),
    ...(message.type === "user" && message.pausesBefore
      ? { pausesBefore: message.pausesBefore }
      : {}),
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
              t.id !== turn.id ? t : { ...turn, interrupted: turn.interrupted || t.interrupted },
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
    };
  }
  const sections = state.sections.map((section) =>
    section.key !== state.current ? section : { ...section, turns: [...section.turns, turn] },
  );
  return { ...state, sections };
}

function applyTitle(
  state: Conversation,
  message: Extract<ConversationMessage, { type: "title" }>,
): Conversation {
  const key = sectionKey(message.title);
  if (!key) return state;
  if (key === state.current) return state;

  let sections = state.sections;
  const existing = sections.find((s) => s.key === key);

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
    sections,
    current: key,
    returns: existing ? state.returns + 1 : state.returns,
  };
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
