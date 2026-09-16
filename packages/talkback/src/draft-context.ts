/**
 * The drafts this drive has produced, rendered for the agent that wrote them.
 *
 * WHY THIS EXISTS. The agent could write a draft and then had no idea it had.
 * Asked to "make that shorter" it wrote a SECOND draft from whatever it could
 * remember of the conversation, and the person ended up with two cards, neither
 * marked as superseding the other. Drafts are the one thing on the screen that
 * was asked for by name, so that is the worst place in the system to have no
 * memory.
 *
 * HANDLES, BECAUSE A DRAFT HAS NO NAME. The model needs to say WHICH draft it
 * is replacing, and a title will not do: two emails to the same person share
 * one, and an index shifts every time a draft is added. So each lineage gets a
 * short stable handle derived from its id, and `revises="3f9a2c"` in the draft
 * tag names it. Derived from the LINEAGE id, not a version id, so the handle
 * survives every rewrite of the same draft.
 *
 * The prompt tells the model never to say a handle out loud — it is wire
 * format, and "three eff nine ay two see" read to a driver is exactly the kind
 * of failure `SILENCE_TOKEN` and the draft tags are also written to avoid.
 *
 * Pure. No I/O — the caller loads the drafts.
 */

/**
 * A short stable name for one draft lineage.
 *
 * The SAME derivation as `cardHandle` in `packages/workspace/src/board-edit.ts`
 * — last six hex characters, lower case — because the model already handles
 * board cards this way and two handle formats in one prompt is a way to get
 * one copied into the other's tag. Long enough that two drafts in one drive
 * will not collide (a drive produces a handful), short enough that a small
 * model copies it without transposing a character, and derived rather than
 * stored so nothing has to be written back for the agent to refer to a draft.
 *
 * `/api/realtime/draft` resolves a handle by comparing this over the drive's
 * own drafts, and a handle that matches none — or more than one — falls back to
 * writing a new draft rather than guessing.
 */
export function draftHandle(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(-6).toLowerCase();
}

/**
 * How much of the turn the drafts may take.
 *
 * The same order as `MAX_CONTEXT_CHARS`, and for the same reason given there:
 * past a point more context makes the answer worse by burying the relevant
 * line. A draft body is long — that is what a draft IS — so without a budget
 * two emails would crowd out recall, the board and the running summary
 * together.
 */
export const MAX_DRAFT_CONTEXT_CHARS = 2000;

/** At most this many drafts are listed at all, newest kept. */
const MAX_DRAFTS_LISTED = 6;

/** What `loadSessionDrafts` returns, narrowed to what rendering needs. */
export interface DraftForContext {
  id: string;
  title: string;
  text: string;
  version: string;
  author: "agent" | "user";
}

export interface DraftContext {
  /** Rendered block, or null when this drive has produced no drafts. */
  text: string | null;
  /** For the analytics on the route — how many bodies were in budget. */
  shown: number;
  total: number;
}

/**
 * Render the drive's drafts: a list of all of them, then as many bodies as fit.
 *
 * TWO LAYERS, deliberately. The LIST is cheap — one line each — and it is what
 * makes the agent able to say "you already have an email to William" instead of
 * writing a second one. The BODIES are what make a revision possible at all,
 * because rewriting text you cannot see is just writing new text.
 *
 * Bodies are added NEWEST FIRST, because "make that shorter" almost always
 * means the one just written, and a body that does not fit is SKIPPED WHOLE
 * rather than cut. A truncated body is the worst of both: the model cannot tell
 * it is truncated, so it rewrites the draft and silently deletes the half it
 * never saw. The listing marks those "text not shown", which the prompt pairs
 * with its rule that only a draft whose text is visible may be revised.
 */
export function buildDraftContext(drafts: readonly DraftForContext[]): DraftContext {
  if (drafts.length === 0) return { text: null, shown: 0, total: 0 };

  // Oldest first is the order they were asked for, which is the order the
  // person remembers them in. The CAP takes the newest, because an early draft
  // from an hour ago is the least likely to be the one being revised.
  const listed = drafts.slice(-MAX_DRAFTS_LISTED);

  /* Newest first for the budget, so the draft most likely to be revised is the
   * one guaranteed to have its text in front of the model.
   *
   * This is a greedy fill and NOT `trimToBudget`, which stops at the first line
   * that does not fit: one long email at the top would then hide every shorter
   * draft behind it, and the short ones are the cheap ones. A body that does
   * not fit is skipped and the fill carries on. */
  const bodies = new Map<string, string>();
  let used = 0;
  for (const draft of [...listed].reverse()) {
    const body = renderBody(draft);
    if (!body) continue;
    if (used + body.length > MAX_DRAFT_CONTEXT_CHARS) continue;
    bodies.set(draft.id, body);
    used += body.length;
  }

  const lines = listed.map((draft) => {
    const who = draft.author === "user" ? "last edited by them" : "written by you";
    const seen = bodies.has(draft.id) ? "" : ", text not shown";
    return `draft ${draftHandle(draft.id)} ${JSON.stringify(draft.title || "untitled")} (${draft.version}, ${who}${seen})`;
  });

  // Bodies in the listing's own order, so the model reads them in the order it
  // just saw them named. The budget decided WHICH; it does not decide the order
  // they are presented in.
  const shownBodies = listed.filter((d) => bodies.has(d.id)).map((d) => bodies.get(d.id)!);

  const text = [
    "Drafts you have written on this drive, and which you can still see:",
    lines.join("\n"),
    // Blank line between bodies: a draft is multi-line by nature, and two run
    // together read as one.
    ...shownBodies,
  ].join("\n\n");

  return { text, shown: bodies.size, total: drafts.length };
}

function renderBody(draft: DraftForContext): string {
  const text = draft.text.trim();
  if (!text) return "";
  return `draft ${draftHandle(draft.id)}:\n${text}`;
}
