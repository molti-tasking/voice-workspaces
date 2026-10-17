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

interface Turn {
  /** The container's id, unique per connection. */
  id: string;
  who: Speaker;
  /** The whole turn so far: each message replaces the last. */
  text: string;
  /** The agent was cut off: they talked over it, or locked it. */
  interrupted?: boolean;
}

export interface Section {
  /** The title folded for matching, or "" for talk before anything was named. */
  key: string;
  title: string | null;
  turns: Turn[];
}

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
  | { type: Speaker; id: string; text: string; interrupted?: boolean }
  | { type: "title"; title: string; rehomeFrom?: string };

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
    };
  }
  if (d.type === "user" || d.type === "agent") {
    if (typeof d.id !== "string" || typeof d.text !== "string") return null;
    return {
      type: d.type,
      id: d.id,
      text: d.text,
      ...(d.interrupted === true ? { interrupted: true } : {}),
    };
  }
  return null;
}

/** How a title is matched to its section: case and spacing do not make a new subject. */
function sectionKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Fold one message into the conversation. Returns the same object when nothing changed. */
export function applyMessage(state: Conversation, message: ConversationMessage): Conversation {
  return message.type === "title" ? applyTitle(state, message) : applyTurn(state, message);
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
      sections: [...state.sections, { key: "", title: null, turns: [turn] }],
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
      sections: sections.map((s) => (s.key === "" ? { ...s, key, title: message.title } : s)),
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
    sections = sections.map((s) => (s.key === key ? { ...s, turns: [...s.turns, ...moved] } : s));
  } else {
    sections = [...sections, { key, title: message.title, turns: moved }];
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
 * subject from before the tunnel comes back under the name it already has.
 */
export function titlesForReconnect(state: Conversation): string[] {
  const named = state.sections.filter((s) => s.title !== null);
  const current = named.find((s) => s.key === state.current);
  return [...named.filter((s) => s !== current), ...(current ? [current] : [])].map(
    (s) => s.title!,
  );
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
      const next = applyMessage(state, message);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}
