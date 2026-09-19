/**
 * Drafts: text the agent handed over to be kept, rather than said.
 *
 * The write side is reached by the voice container, through
 * `/api/realtime/draft`, and by the person, through
 * `/api/drafts/[draftId]/versions`. The read side feeds two places — the live
 * cue panel during a drive and the session page afterwards — and both read
 * Postgres directly, so a draft survives a reload, a tunnel, and the container
 * dying. That is the same rule the rest of the display follows: the ledger is
 * durable, the conversation is ephemeral.
 *
 * ## Two tables, and why
 *
 * `agent_draft` is the draft's IDENTITY — which drive, where in it, which
 * `seq` the container gave it — and is never updated. `agent_draft_version`
 * holds every version, append-only, one row each. The split is the same one
 * `capability` / `capability_version` already uses, and it is what lets a
 * rewrite be the SAME draft rather than a second card claiming to be just as
 * current as the first.
 *
 * ## The numbers say who
 *
 * The agent owns the major, the person owns the minor. v1.0 is what the agent
 * first wrote; the person editing it gives v1.1; the agent rewriting gives
 * v2.0; editing that gives v2.1. Nothing else has to be consulted to read, off
 * a card weeks later, how many times the model tried and how much hand editing
 * each attempt took.
 *
 * ## The newest version is always the current one
 *
 * A restore appends rather than moving a pointer, so restoring v1.1 while at
 * v1.3 gives v1.4 labelled "restored from v1.1". This keeps the record
 * append-only (EVALUATION_PLAN.md §4) and makes "what did they end up with" a
 * single `order by (major, minor) desc limit 1` rather than a flag two writers
 * can disagree about.
 *
 * Ordering is ALWAYS by `(major, minor)` and never by `createdAt`: the
 * container and the web app keep different clocks, and two versions can share a
 * millisecond.
 */
import { and, asc, desc, eq, max } from "drizzle-orm";
import { agentDraft, agentDraftVersion, captureSession } from "./schema";
import { getDb } from "./index";

export type DraftAuthor = "agent" | "user";

/** `v2.1` — the agent's second draft, edited once by the person. */
export function draftVersionLabel(major: number, minor: number): string {
  return `v${major}.${minor}`;
}

/** One row of `agent_draft_version`, with its label already rendered. */
export interface DraftVersion {
  id: string;
  draftId: string;
  major: number;
  minor: number;
  /** `draftVersionLabel(major, minor)`. */
  version: string;
  author: DraftAuthor;
  title: string;
  text: string;
  restoredFromVersionId: string | null;
  /** What was asked for, when the agent wrote this version. */
  respondingToText: string | null;
  createdAt: Date;
}

/**
 * A draft as the panel and the session page show it: the lineage's identity,
 * carrying its CURRENT version's content.
 *
 * The field names the two readers already used are kept, so neither had to
 * learn the two-table shape to render a card.
 */
export interface Draft {
  /** The LINEAGE id, stable across every version. Also the card's React key. */
  id: string;
  seq: number;
  startOffsetMs: number;
  title: string;
  text: string;
  /** The request behind the CURRENT version — the rewrite's, not the original's. */
  respondingToText: string | null;
  /** When the draft was first asked for. */
  createdAt: Date;
  /** The current version's row id, which an edit sends back as its base. */
  versionId: string;
  /** `v2.1`. */
  version: string;
  author: DraftAuthor;
  /** When the current version was written. */
  updatedAt: Date;
}

export interface RecordDraftInput {
  captureSessionId: string;
  seq: number;
  startOffsetMs: number;
  title: string;
  text: string;
  respondingToText?: string | null;
}

/**
 * Write a NEW draft, at v1.0. Idempotent on `(captureSessionId, seq)`.
 *
 * The container fires this off without awaiting a reply and retries nothing by
 * itself, but a POST that times out after the row landed would otherwise leave
 * a second copy on the screen if it were ever retried. `seq` is the container's
 * own counter for the drive, so the conflict target is a fact about the
 * conversation rather than a hash of the text — two genuinely different drafts
 * with identical wording still both land.
 *
 * The lineage and its v1.0 go in ONE transaction, and the v1.0 insert is gated
 * on the lineage insert having actually returned a row. A retry therefore
 * cannot append a second v1.0 to a lineage that already has one, which the
 * unique index would refuse anyway — but refusing it inside the transaction
 * turns a 500 into a no-op.
 *
 * Returns the lineage id, or null when `(session, seq)` was already taken —
 * which means a retry, not a failure.
 */
export async function recordDraft(
  input: RecordDraftInput,
): Promise<{ draftId: string } | null> {
  return getDb().transaction(async (tx) => {
    const [lineage] = await tx
      .insert(agentDraft)
      .values({
        captureSessionId: input.captureSessionId,
        seq: input.seq,
        startOffsetMs: input.startOffsetMs,
        // Still written, and read by nothing. See the comment on `agentDraft`:
        // a frozen copy of v1.0, kept because the append-only rule says a
        // column that recorded what the agent produced does not stop recording
        // it just because a better home now exists.
        title: input.title,
        text: input.text,
        respondingToText: input.respondingToText ?? null,
      })
      .onConflictDoNothing({
        target: [agentDraft.captureSessionId, agentDraft.seq],
      })
      .returning({ id: agentDraft.id });

    if (!lineage) return null;

    await tx.insert(agentDraftVersion).values({
      draftId: lineage.id,
      major: 1,
      minor: 0,
      author: "agent",
      title: input.title,
      text: input.text,
      respondingToText: input.respondingToText ?? null,
    });

    return { draftId: lineage.id };
  });
}

/**
 * The seq a reconnecting container should carry on from.
 *
 * `DraftRecorder` counts from 0 for the life of a process, and a drive can
 * outlive several of them — a tunnel, a container restart, the person leaving
 * the page and coming back. The second process would then re-issue seq 0, 1, 2
 * against a drive that already has those rows, and `recordDraft`'s
 * `onConflictDoNothing` would swallow every draft of the rest of the drive
 * WITHOUT an error anywhere: the POST returns 200, the container logs "stored",
 * and the person never sees the thing they asked for. The idempotency that
 * makes a retry safe is exactly what makes a restart silent.
 *
 * So the seq is seeded from the ledger at connect, which is the only place that
 * knows. Returns 0 for a drive with no drafts yet, which is where a fresh
 * container would have started anyway.
 */
export async function nextDraftSeq(captureSessionId: string): Promise<number> {
  const [row] = await getDb()
    .select({ seq: max(agentDraft.seq) })
    .from(agentDraft)
    .where(eq(agentDraft.captureSessionId, captureSessionId));
  return row?.seq === null || row?.seq === undefined ? 0 : row.seq + 1;
}

/** New content, or the version to copy forward. */
export type DraftVersionContent =
  | { title: string; text: string }
  | { restoreVersionId: string };

export interface AppendDraftVersionInput {
  draftId: string;
  /** Proved against `capture_session.userId`; a stranger gets `not_found`. */
  userId: string;
  author: DraftAuthor;
  content: DraftVersionContent;
  /**
   * The version the writer was looking at.
   *
   * Omitted by the container, which has no page open and whose rewrite is
   * always aimed at whatever is current. Sent by the browser, where two tabs —
   * or a tab left open while the agent rewrote the draft — can otherwise
   * silently overwrite a version the person never saw.
   */
  baseVersionId?: string;
  /** What was said to get this version. Agent writes only. */
  respondingToText?: string | null;
}

export type AppendDraftVersionResult =
  | { status: "created"; version: DraftVersion }
  /** Identical to the current version, so nothing was appended. */
  | { status: "unchanged"; head: DraftVersion }
  /** The draft moved on while they were typing. `head` is where it moved to. */
  | { status: "conflict"; head: DraftVersion }
  /** No such draft, not theirs, or a restore target from another draft. */
  | { status: "not_found" };

/**
 * Append the next version of a draft.
 *
 * ## Why a transaction with a row lock
 *
 * Reading the current version and inserting the next one has to be atomic
 * against the other writer. The person's Save and the agent's rewrite are two
 * processes — the browser and the container — and both compute their number
 * from what they just read; without the lock both can read v1.0 and both try to
 * write v1.1 and v2.0 against a head that has moved. The lock is taken `of` the
 * `agent_draft` LINEAGE row, which is the one row every version of one draft
 * shares, and it is joined to `capture_session` so that ownership is proved by
 * the same query rather than by a second round trip. That is the shape
 * `appendOps` in `workspace.ts` already uses for the same reason.
 *
 * ## The checks, in this order
 *
 * 1. **Unchanged.** Title and text identical to the current version → append
 *    nothing. This is what makes a double-submit — a slow Save tapped twice, a
 *    retried POST — free rather than a second identical version on the page.
 * 2. **Conflict.** A `baseVersionId` that is no longer the current version
 *    means the writer was looking at something else. Their text is NOT
 *    discarded here; the caller is handed the new head and shows both.
 * 3. Otherwise append.
 *
 * Unchanged is checked BEFORE conflict on purpose: a retry of a save that
 * already landed carries a stale base by construction, and reporting that as a
 * conflict would ask the person to resolve a difference that does not exist.
 *
 * Between them these make every write idempotent enough that no client-minted
 * key is needed — unlike the board, where two moves to the same column are
 * genuinely two gestures.
 */
export async function appendDraftVersion(
  input: AppendDraftVersionInput,
): Promise<AppendDraftVersionResult> {
  const db = getDb();

  return db.transaction(async (tx): Promise<AppendDraftVersionResult> => {
    const [owned] = await tx
      .select({ id: agentDraft.id })
      .from(agentDraft)
      .innerJoin(captureSession, eq(captureSession.id, agentDraft.captureSessionId))
      .where(and(eq(agentDraft.id, input.draftId), eq(captureSession.userId, input.userId)))
      // Only the lineage row: `capture_session` is here to prove ownership, and
      // locking a whole drive's row to edit one draft would serialise the
      // recorder against the desk.
      .for("update", { of: agentDraft });

    if (!owned) return { status: "not_found" };

    const [current] = await tx
      .select()
      .from(agentDraftVersion)
      .where(eq(agentDraftVersion.draftId, input.draftId))
      // By number, never by time. See the module header.
      .orderBy(desc(agentDraftVersion.major), desc(agentDraftVersion.minor))
      .limit(1);

    // A lineage with no versions cannot be appended to, because there is no
    // number to follow. Only reachable if the backfill in
    // `0011_draft_versions.sql` has not run, and a 404 is a far better way to
    // find that out than a row numbered v1.0 sitting under a v1.0 that exists.
    if (!current) return { status: "not_found" };

    let title: string;
    let text: string;
    let restoredFromVersionId: string | null = null;

    if ("restoreVersionId" in input.content) {
      const [target] = await tx
        .select()
        .from(agentDraftVersion)
        .where(
          and(
            eq(agentDraftVersion.id, input.content.restoreVersionId),
            // AND the same draft. Without this, a version id from somebody
            // else's draft — or from another draft of their own — would be
            // copied across lineages, which is how a restore becomes a leak.
            eq(agentDraftVersion.draftId, input.draftId),
          ),
        )
        .limit(1);

      if (!target) return { status: "not_found" };

      title = target.title;
      text = target.text;
      restoredFromVersionId = target.id;
    } else {
      // An agent rewrite with no title keeps the one it had. The model is told
      // to write the whole new text, and it routinely omits the title on a
      // "make it shorter" — blanking the card's heading for that is a
      // regression the person never asked for. A PERSON clearing the title has
      // decided to clear it, and `/api/drafts/[draftId]/versions` does not
      // apply this.
      title =
        input.author === "agent" && !input.content.title.trim()
          ? current.title
          : input.content.title;
      text = input.content.text;
    }

    if (title === current.title && text === current.text) {
      return { status: "unchanged", head: toVersion(current) };
    }

    if (input.baseVersionId !== undefined && input.baseVersionId !== current.id) {
      return { status: "conflict", head: toVersion(current) };
    }

    // The agent owns the major and the person owns the minor. A rewrite resets
    // the minor to 0 because the hand edits belonged to the text it replaced.
    const major = input.author === "agent" ? current.major + 1 : current.major;
    const minor = input.author === "agent" ? 0 : current.minor + 1;

    const [row] = await tx
      .insert(agentDraftVersion)
      .values({
        draftId: input.draftId,
        major,
        minor,
        author: input.author,
        title,
        text,
        restoredFromVersionId,
        respondingToText: input.respondingToText ?? null,
      })
      .returning();

    return { status: "created", version: toVersion(row!) };
  });
}

/**
 * Every draft from one drive at its CURRENT version, oldest first.
 *
 * `DISTINCT ON (draft_id)` with the version ordering picks the head of each
 * lineage in one query rather than one query per draft, and the join to
 * `agent_draft` both scopes it to the session and carries the lineage's own
 * fields. The final ordering — the order they were ASKED for — cannot be done
 * in the same statement, because `DISTINCT ON` requires its own expressions to
 * lead the `ORDER BY`; a handful of drafts per drive makes sorting them in JS
 * the cheaper half of that trade.
 */
export async function loadSessionDrafts(captureSessionId: string): Promise<Draft[]> {
  const rows = await getDb()
    .selectDistinctOn([agentDraftVersion.draftId], {
      id: agentDraft.id,
      seq: agentDraft.seq,
      startOffsetMs: agentDraft.startOffsetMs,
      createdAt: agentDraft.createdAt,
      versionId: agentDraftVersion.id,
      major: agentDraftVersion.major,
      minor: agentDraftVersion.minor,
      author: agentDraftVersion.author,
      title: agentDraftVersion.title,
      text: agentDraftVersion.text,
      respondingToText: agentDraftVersion.respondingToText,
      updatedAt: agentDraftVersion.createdAt,
    })
    .from(agentDraftVersion)
    .innerJoin(agentDraft, eq(agentDraft.id, agentDraftVersion.draftId))
    .where(eq(agentDraft.captureSessionId, captureSessionId))
    .orderBy(
      asc(agentDraftVersion.draftId),
      desc(agentDraftVersion.major),
      desc(agentDraftVersion.minor),
    );

  return rows
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      startOffsetMs: r.startOffsetMs,
      title: r.title,
      text: r.text,
      respondingToText: r.respondingToText,
      createdAt: r.createdAt,
      versionId: r.versionId,
      version: draftVersionLabel(r.major, r.minor),
      author: r.author,
      updatedAt: r.updatedAt,
    }))
    .sort(byAsked);
}

/** One lineage with its whole history, for the session page. */
export interface DraftHistory {
  /** The LINEAGE id. The card is keyed on this, so an open editor survives a refresh. */
  id: string;
  seq: number;
  startOffsetMs: number;
  /** When the draft was first asked for. */
  createdAt: Date;
  current: DraftVersionView;
  /** Everything before `current`, NEWEST first — the order a history is read. */
  earlier: DraftVersionView[];
}

export interface DraftVersionView extends DraftVersion {
  /** `v1.1` when this version was a restore, else null. Resolved here, not in the page. */
  restoredFrom: string | null;
}

/**
 * Every draft from one drive with every version it has had.
 *
 * ONE query for the whole session, grouped in JS. A drive produces a handful of
 * drafts with a handful of versions each, so the alternative — a query per
 * lineage, or a lateral join — would buy nothing and cost a round trip per
 * card on a page that is already server-rendered.
 */
export async function loadSessionDraftHistory(
  captureSessionId: string,
): Promise<DraftHistory[]> {
  const rows = await getDb()
    .select({
      draftId: agentDraft.id,
      seq: agentDraft.seq,
      startOffsetMs: agentDraft.startOffsetMs,
      createdAt: agentDraft.createdAt,
      version: agentDraftVersion,
    })
    .from(agentDraftVersion)
    .innerJoin(agentDraft, eq(agentDraft.id, agentDraftVersion.draftId))
    .where(eq(agentDraft.captureSessionId, captureSessionId))
    .orderBy(
      asc(agentDraft.createdAt),
      asc(agentDraft.seq),
      desc(agentDraftVersion.major),
      desc(agentDraftVersion.minor),
    );

  // Labels for the "restored from vX.Y" line, which needs the TARGET's number
  // and not its id. Built over the whole session in one pass: a restore can
  // only point inside its own lineage, so this map is complete by construction.
  const labels = new Map<string, string>();
  for (const r of rows) labels.set(r.version.id, draftVersionLabel(r.version.major, r.version.minor));

  const byDraft = new Map<string, DraftHistory>();
  for (const r of rows) {
    const view: DraftVersionView = {
      ...toVersion(r.version),
      restoredFrom: r.version.restoredFromVersionId
        ? (labels.get(r.version.restoredFromVersionId) ?? null)
        : null,
    };

    const existing = byDraft.get(r.draftId);
    if (!existing) {
      // Rows arrive newest version first, so the first one seen is the head.
      byDraft.set(r.draftId, {
        id: r.draftId,
        seq: r.seq,
        startOffsetMs: r.startOffsetMs,
        createdAt: r.createdAt,
        current: view,
        earlier: [],
      });
    } else {
      existing.earlier.push(view);
    }
  }

  return [...byDraft.values()].sort(byAsked);
}

/** The order they were asked for: when the lineage was created, then its seq. */
function byAsked(
  a: { createdAt: Date; seq: number },
  b: { createdAt: Date; seq: number },
): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.seq - b.seq;
}

function toVersion(row: typeof agentDraftVersion.$inferSelect): DraftVersion {
  return {
    id: row.id,
    draftId: row.draftId,
    major: row.major,
    minor: row.minor,
    version: draftVersionLabel(row.major, row.minor),
    author: row.author,
    title: row.title,
    text: row.text,
    restoredFromVersionId: row.restoredFromVersionId,
    respondingToText: row.respondingToText,
    createdAt: row.createdAt,
  };
}
