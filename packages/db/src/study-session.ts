import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  SESSION_HOLD_MS,
  SESSION_VERSION,
  blocksFor,
  cellCount,
  isRealProlificPid,
  isSessionTaskId,
  leastFilledCell,
  type BlockAnswers,
  type ConversationDisplay,
  type DesignInput,
  type SessionDesign,
  type SessionFinal,
  type SessionMoment,
  type SessionProgress,
  ConversationDisplay as Display,
} from "@voicemural/shared";
import {
  agentTurn,
  driveSubject,
  driveSubjectSegment,
  studyBlock,
  studyDesign,
  studyMoment,
  studySession,
  user,
  utterance,
} from "./schema";
import { getDb } from "./index";

/**
 * The display study's setups, sessions and their blocks (`study_design`,
 * `study_session`, `study_block`; `study-session.ts` in @voicemural/shared).
 *
 * A session is made in a setup — by a researcher before anyone sees it, or
 * when a participant from Prolific consents — claimed by the account that
 * consents, and then walked through block by block: armed, talked (the drive
 * links itself when it registers), finished and answered.
 *
 * Every write here is first-one-stands, as in the Prolific study: a reload, a
 * double tap or a second tab must never overwrite an answer already given.
 */

export type StudyDesign = typeof studyDesign.$inferSelect;
export type StudySession = typeof studySession.$inferSelect;
export type StudyBlock = typeof studyBlock.$inferSelect;

export interface SessionWithBlocks {
  session: StudySession;
  /** In position order. */
  blocks: StudyBlock[];
}

/**
 * Pseudonyms: F01, F02, … for invites (F for formative), P01, … for Prolific's
 * participants, T01, … for a researcher's tests.
 */
export const SESSION_REF_PREFIX = "F";
export const PROLIFIC_REF_PREFIX = "P";
export const TEST_REF_PREFIX = "T";

/**
 * How long an armed block waits for its drive. The page arms it a moment
 * before it starts the recorder; one still armed an hour later is a page that
 * was closed, and must not capture the next drive this account makes.
 */
export const ARM_TTL_MS = 15 * 60_000;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** One lock for everything that hands out a pseudonym, a cell or a session. */
async function lock(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('study_session'))`);
}

/* ---------------------------------------------------------------------------
 * Setups
 * ------------------------------------------------------------------------- */

/** A setup as `cellFor` reads it: its views by their current names, its known tasks. */
export function designPlan(design: Pick<StudyDesign, "name" | "views" | "tasks">): SessionDesign {
  return {
    name: design.name,
    views: design.views.map((v) => Display.parse(v)),
    tasks: design.tasks.filter(isSessionTaskId),
  };
}

export interface DesignSummary {
  design: StudyDesign;
  /** Sessions filed under it, tests left out; how many of them are complete. */
  sessions: number;
  completed: number;
  tests: number;
}

/** Every setup, the active one first and then the newest, with what is filed under it. */
export async function listDesigns(): Promise<DesignSummary[]> {
  const db = getDb();
  const [designs, counts] = await Promise.all([
    db.select().from(studyDesign).orderBy(desc(studyDesign.createdAt)),
    db
      .select({
        design: studySession.design,
        test: studySession.test,
        sessions: count(),
        completed: sql<number>`count(${studySession.completedAt})::int`,
      })
      .from(studySession)
      .groupBy(studySession.design, studySession.test),
  ]);
  const of = (name: string, test: boolean) => counts.find((c) => c.design === name && c.test === test);
  return designs
    .map((design) => ({
      design,
      sessions: of(design.name, false)?.sessions ?? 0,
      completed: of(design.name, false)?.completed ?? 0,
      tests: of(design.name, true)?.sessions ?? 0,
    }))
    .sort((a, b) => Number(b.design.status === "active") - Number(a.design.status === "active"));
}

export async function findDesign(name: string): Promise<StudyDesign | null> {
  const [row] = await getDb().select().from(studyDesign).where(eq(studyDesign.name, name)).limit(1);
  return row ?? null;
}

/** The setup new sessions go to: Prolific's link and new invites. */
export async function activeDesign(): Promise<StudyDesign | null> {
  const [row] = await getDb().select().from(studyDesign).where(eq(studyDesign.status, "active")).limit(1);
  return row ?? null;
}

export type DesignResult =
  | { ok: true; design: StudyDesign }
  | { ok: false; reason: "unknown" | "taken" | "has_sessions" };

/** A new setup, as a draft: nothing goes to it until it is made active. */
export async function createDesign(input: DesignInput): Promise<DesignResult> {
  const inserted = await getDb()
    .insert(studyDesign)
    .values({ ...input, views: [...input.views], tasks: [...input.tasks], status: "draft" })
    .onConflictDoNothing({ target: studyDesign.name })
    .returning();
  return inserted[0] ? { ok: true, design: inserted[0] } : { ok: false, reason: "taken" };
}

/**
 * Make a setup the one new sessions go to; the one that was, closes. Or close
 * one. A closed setup can be made active again: its sessions are unchanged.
 */
export async function setDesignStatus(name: string, status: "active" | "closed", now = new Date()): Promise<DesignResult> {
  return getDb().transaction(async (tx) => {
    await lock(tx);
    const [target] = await tx.select().from(studyDesign).where(eq(studyDesign.name, name)).limit(1);
    if (!target) return { ok: false, reason: "unknown" };
    if (target.status === status) return { ok: true, design: target };
    if (status === "active") {
      await tx
        .update(studyDesign)
        .set({ status: "closed", closedAt: now })
        .where(and(eq(studyDesign.status, "active"), ne(studyDesign.id, target.id)));
    }
    const [updated] = await tx
      .update(studyDesign)
      .set(status === "active" ? { status, activatedAt: now, closedAt: null } : { status, closedAt: now })
      .where(eq(studyDesign.id, target.id))
      .returning();
    return { ok: true, design: updated! };
  });
}

/** What may change about a setup at any time: its completion code and its note. */
export async function updateDesignDetails(
  name: string,
  details: { completionCode?: string | null; note?: string | null },
): Promise<DesignResult> {
  const [updated] = await getDb().update(studyDesign).set(details).where(eq(studyDesign.name, name)).returning();
  return updated ? { ok: true, design: updated } : { ok: false, reason: "unknown" };
}

/** A setup nobody took part in — tests deleted first. Refused for one with sessions. */
export async function deleteDesign(name: string): Promise<DesignResult> {
  return getDb().transaction(async (tx) => {
    await lock(tx);
    const [target] = await tx.select().from(studyDesign).where(eq(studyDesign.name, name)).limit(1);
    if (!target) return { ok: false, reason: "unknown" };
    const [used] = await tx.select({ id: studySession.id }).from(studySession).where(eq(studySession.design, name)).limit(1);
    if (used) return { ok: false, reason: "has_sessions" };
    await tx.delete(studyDesign).where(eq(studyDesign.id, target.id));
    return { ok: true, design: target };
  });
}

/* ---------------------------------------------------------------------------
 * Making a session
 * ------------------------------------------------------------------------- */

/**
 * How many sessions hold each of a setup's cells: complete, or begun within
 * `SESSION_HOLD_MS` (consented, or for an invite not yet opened, made). Tests
 * hold none.
 */
async function heldCells(tx: Tx, design: StudyDesign, now: Date): Promise<number[]> {
  const n = cellCount(designPlan(design));
  const since = new Date(now.getTime() - SESSION_HOLD_MS);
  const rows = await tx
    .select({ orderIndex: studySession.orderIndex, n: count() })
    .from(studySession)
    .where(
      and(
        eq(studySession.design, design.name),
        eq(studySession.test, false),
        or(
          isNotNull(studySession.completedAt),
          sql`coalesce(${studySession.consentedAt}, ${studySession.createdAt}) > ${since.toISOString()}::timestamptz`,
        ),
      ),
    )
    .groupBy(studySession.orderIndex);
  const held = new Array<number>(n).fill(0);
  for (const row of rows) held[((row.orderIndex % n) + n) % n]! += row.n;
  return held;
}

/** The next free pseudonym with this prefix: one more than the highest so far. */
async function nextRef(tx: Tx, prefix: string): Promise<string> {
  const [{ last }] = (await tx
    // The position cast: a text parameter would make it substring's regex form.
    .select({ last: sql<number | null>`max(substring(${studySession.ref} from ${prefix.length + 1}::int)::int)` })
    .from(studySession)
    .where(sql`${studySession.ref} ~ ${`^${prefix}[0-9]+$`}`)) as [{ last: number | null }];
  return prefix + String((last ?? 0) + 1).padStart(2, "0");
}

type NewSession = Omit<typeof studySession.$inferInsert, "design" | "orderIndex" | "ref">;

/**
 * Write a session and its block into `design`'s cell: `orderIndex` if pinned,
 * else the least held. Inside the caller's transaction, under its lock.
 */
async function insertSession(
  tx: Tx,
  design: StudyDesign,
  values: NewSession & { ref: string; orderIndex?: number },
  now: Date,
): Promise<SessionWithBlocks> {
  const plan = designPlan(design);
  const n = cellCount(plan);
  if (n === 0) throw new Error(`the setup ${design.name} has no views or no tasks`);
  if (values.orderIndex !== undefined && (!Number.isInteger(values.orderIndex) || values.orderIndex < 0 || values.orderIndex >= n)) {
    throw new Error(`the setup ${design.name} has cells 0 to ${n - 1}`);
  }
  const orderIndex = values.orderIndex ?? leastFilledCell(await heldCells(tx, design, now));
  const [session] = await tx
    .insert(studySession)
    .values({ ...values, design: design.name, orderIndex })
    .returning();
  const blocks = await tx
    .insert(studyBlock)
    .values(blocksFor(plan, orderIndex).map((b) => ({ sessionId: session!.id, ...b })))
    .returning();
  return { session: session!, blocks: blocks.sort((a, b) => a.position - b.position) };
}

/**
 * A new invite with its block, ready to be sent as a link: in the active
 * setup unless another is named, in the least held cell unless `orderIndex`
 * pins it.
 *
 * A test may be made in any setup, a draft's included, to try it before it
 * runs; it holds no cell and is filed as a test. A real invite only in a
 * setup that is not closed.
 */
export async function createSession(
  input: { design?: string; ref?: string; orderIndex?: number; test?: boolean; now?: Date } = {},
): Promise<SessionWithBlocks> {
  const now = input.now ?? new Date();
  const test = input.test ?? false;
  return getDb().transaction(async (tx) => {
    await lock(tx);
    const [design] = await tx
      .select()
      .from(studyDesign)
      .where(input.design === undefined ? eq(studyDesign.status, "active") : eq(studyDesign.name, input.design))
      .limit(1);
    if (!design) throw new Error(input.design === undefined ? "no setup is active" : `no setup is called ${input.design}`);
    if (design.status === "closed" && !test) throw new Error(`the setup ${design.name} is closed`);

    let ref = input.ref;
    if (ref === undefined) {
      ref = await nextRef(tx, test ? TEST_REF_PREFIX : SESSION_REF_PREFIX);
    } else {
      const [taken] = await tx.select({ id: studySession.id }).from(studySession).where(eq(studySession.ref, ref)).limit(1);
      if (taken) throw new Error(`the pseudonym ${ref} is taken`);
    }
    return insertSession(
      tx,
      design,
      { ref, orderIndex: input.orderIndex, test, inviteCode: randomBytes(18).toString("base64url"), createdAt: now },
      now,
    );
  });
}

async function withBlocks(session: StudySession | undefined): Promise<SessionWithBlocks | null> {
  if (!session) return null;
  const blocks = await getDb()
    .select()
    .from(studyBlock)
    .where(eq(studyBlock.sessionId, session.id))
    .orderBy(asc(studyBlock.position));
  return { session, blocks };
}

/** Where a session stands, for `resumeAt` in @voicemural/shared. */
export function progressOf({ session, blocks }: SessionWithBlocks): SessionProgress {
  return {
    consented: session.consentedAt !== null,
    completed: session.completedAt !== null,
    blocks: blocks.map((b) => ({ position: b.position, finished: b.finishedAt !== null, answered: b.answeredAt !== null })),
  };
}

export async function findSessionByCode(code: string): Promise<SessionWithBlocks | null> {
  const [session] = await getDb().select().from(studySession).where(eq(studySession.inviteCode, code)).limit(1);
  return withBlocks(session);
}

export async function findSessionByPid(pid: string): Promise<SessionWithBlocks | null> {
  const [session] = await getDb().select().from(studySession).where(eq(studySession.prolificPid, pid)).limit(1);
  return withBlocks(session);
}

export async function findSessionByUser(userId: string): Promise<SessionWithBlocks | null> {
  const [session] = await getDb()
    .select()
    .from(studySession)
    .where(eq(studySession.userId, userId))
    .orderBy(desc(studySession.createdAt))
    .limit(1);
  return withBlocks(session);
}

/**
 * Sessions oldest first, for the researchers: every one, or one setup's;
 * tests only when asked for.
 */
export async function listSessions(
  options: { design?: string; tests?: boolean } = {},
): Promise<SessionWithBlocks[]> {
  const db = getDb();
  const where = and(
    options.design === undefined ? undefined : eq(studySession.design, options.design),
    options.tests ? undefined : eq(studySession.test, false),
  );
  const sessions = await db.select().from(studySession).where(where).orderBy(asc(studySession.createdAt));
  if (sessions.length === 0) return [];
  const blocks = await db
    .select()
    .from(studyBlock)
    .where(inArray(studyBlock.sessionId, sessions.map((s) => s.id)))
    .orderBy(asc(studyBlock.position));
  return sessions.map((session) => ({ session, blocks: blocks.filter((b) => b.sessionId === session.id) }));
}

/** Delete a setup's tests, or every test: their blocks and moments go with them. The number deleted. */
export async function deleteTestSessions(design?: string): Promise<number> {
  const deleted = await getDb()
    .delete(studySession)
    .where(and(eq(studySession.test, true), design === undefined ? undefined : eq(studySession.design, design)))
    .returning({ id: studySession.id });
  return deleted.length;
}

export type ClaimResult =
  | { ok: true; session: StudySession }
  /** No session has this code. */
  | { ok: false; reason: "unknown" }
  /**
   * A signed-in account, not a guest, where accounts are not allowed: a
   * researcher's everyday browser, or a participant who has one. Its drives
   * would reach their workspace, their memory and the field study's export.
   */
  | { ok: false; reason: "not_a_guest" }
  /** This account already holds another session: the browser needs a fresh guest. */
  | { ok: false; reason: "other_session" }
  /** Somebody else has started this session, in another browser. */
  | { ok: false; reason: "claimed_elsewhere" };

/**
 * Consent given on the session's link: the session becomes this account's.
 *
 * - Unclaimed: claimed now.
 * - Already this account's: unchanged (a reload).
 * - Another account's, nothing recorded yet: moved here (the link was opened
 *   in a second browser before starting).
 * - Another account's with a conversation started: refused.
 */
export async function claimSession(input: {
  code: string;
  userId: string;
  /** `STUDY_SESSION_ALLOW_ACCOUNTS`: let a signed-in account take part as itself. */
  allowAccounts?: boolean;
  now?: Date;
}): Promise<ClaimResult> {
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    await lock(tx);

    const [account] = await tx.select({ isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, input.userId)).limit(1);
    if (!account) return { ok: false, reason: "unknown" };
    if (!account.isAnonymous && !input.allowAccounts) return { ok: false, reason: "not_a_guest" };

    const [target] = await tx.select().from(studySession).where(eq(studySession.inviteCode, input.code)).limit(1);
    if (!target) return { ok: false, reason: "unknown" };

    const [other] = await tx
      .select({ id: studySession.id })
      .from(studySession)
      .where(and(eq(studySession.userId, input.userId), ne(studySession.id, target.id)))
      .limit(1);
    if (other) return { ok: false, reason: "other_session" };

    if (target.userId === input.userId) {
      if (target.consentedAt) return { ok: true, session: target };
      const [consented] = await tx
        .update(studySession)
        .set({ consentedAt: now })
        .where(eq(studySession.id, target.id))
        .returning();
      return { ok: true, session: consented! };
    }

    if (target.userId !== null) {
      const [started] = await tx
        .select({ id: studyBlock.id })
        .from(studyBlock)
        .where(and(eq(studyBlock.sessionId, target.id), sql`${studyBlock.attempts} > 0`))
        .limit(1);
      if (started) return { ok: false, reason: "claimed_elsewhere" };
    }

    const [claimed] = await tx
      .update(studySession)
      .set({ userId: input.userId, claimedAt: now, consentedAt: now })
      .where(eq(studySession.id, target.id))
      .returning();
    return { ok: true, session: claimed! };
  });
}

export type ProlificStartResult =
  | { ok: true; state: SessionWithBlocks }
  | { ok: false; reason: "unknown" | "not_a_guest" | "other_session" | "claimed_elsewhere" }
  /** No setup is active, or — where a code is required — the active one has no completion code. */
  | { ok: false; reason: "closed" };

/**
 * Consent given by a participant who arrived from Prolific: their session,
 * by their Prolific ID, becomes this account's — made now, in the active
 * setup's least held cell, if they have none yet.
 *
 * The same rules as an invite's claim (`claimSession`): a reload changes
 * nothing; a second browser takes it over only while nothing was recorded.
 * A Prolific ID that is not one Prolific issues — a researcher's `test-…` —
 * makes a test.
 *
 * `requireCode`: refuse a new session where the setup cannot pay for it, so
 * nobody does the study and then finds there is no code (production).
 */
export async function startProlificSession(input: {
  pid: string;
  studyId?: string;
  sessionId?: string;
  userId: string;
  allowAccounts?: boolean;
  requireCode?: boolean;
  now?: Date;
}): Promise<ProlificStartResult> {
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    await lock(tx);

    const [account] = await tx.select({ isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, input.userId)).limit(1);
    if (!account) return { ok: false, reason: "unknown" };
    if (!account.isAnonymous && !input.allowAccounts) return { ok: false, reason: "not_a_guest" };

    const [existing] = await tx.select().from(studySession).where(eq(studySession.prolificPid, input.pid)).limit(1);
    const [other] = await tx
      .select({ id: studySession.id })
      .from(studySession)
      .where(
        existing
          ? and(eq(studySession.userId, input.userId), ne(studySession.id, existing.id))
          : eq(studySession.userId, input.userId),
      )
      .limit(1);
    if (other) return { ok: false, reason: "other_session" };

    if (existing) {
      if (existing.userId !== input.userId && existing.userId !== null) {
        const [started] = await tx
          .select({ id: studyBlock.id })
          .from(studyBlock)
          .where(and(eq(studyBlock.sessionId, existing.id), sql`${studyBlock.attempts} > 0`))
          .limit(1);
        if (started) return { ok: false, reason: "claimed_elsewhere" };
      }
      const [session] =
        existing.userId === input.userId && existing.consentedAt
          ? [existing]
          : await tx
              .update(studySession)
              .set({ userId: input.userId, claimedAt: now, consentedAt: now })
              .where(eq(studySession.id, existing.id))
              .returning();
      const blocks = await tx
        .select()
        .from(studyBlock)
        .where(eq(studyBlock.sessionId, existing.id))
        .orderBy(asc(studyBlock.position));
      return { ok: true, state: { session: session!, blocks } };
    }

    const [design] = await tx.select().from(studyDesign).where(eq(studyDesign.status, "active")).limit(1);
    if (!design || (input.requireCode && !design.completionCode)) return { ok: false, reason: "closed" };

    const test = !isRealProlificPid(input.pid);
    const state = await insertSession(
      tx,
      design,
      {
        ref: await nextRef(tx, test ? TEST_REF_PREFIX : PROLIFIC_REF_PREFIX),
        source: "prolific",
        prolificPid: input.pid,
        prolificStudyId: input.studyId ?? null,
        prolificSessionId: input.sessionId ?? null,
        test,
        userId: input.userId,
        claimedAt: now,
        consentedAt: now,
        createdAt: now,
      },
      now,
    );
    return { ok: true, state };
  });
}

/** The session this account is doing now: consented, not yet complete. */
async function activeSession(userId: string): Promise<SessionWithBlocks | null> {
  const state = await findSessionByUser(userId);
  if (!state?.session.consentedAt || state.session.completedAt) return null;
  return state;
}

export type ArmResult = "armed" | "no_session" | "out_of_order" | "done";

/**
 * About to start this block's conversation: its next drive will be it. The
 * page arms when it shows the brief, so the tap on Start opens the microphone
 * with nothing in between; arming again just renews it. Refused for a block
 * already talked, and for one whose turn has not come — the order is the
 * design.
 */
export async function armBlock(userId: string, position: number, now = new Date()): Promise<ArmResult> {
  const state = await activeSession(userId);
  const block = state?.blocks.find((b) => b.position === position);
  if (!state || !block) return "no_session";
  if (block.finishedAt || block.answeredAt) return "done";
  if (state.blocks.some((b) => b.position < position && !b.answeredAt)) return "out_of_order";
  await getDb().update(studyBlock).set({ armedAt: now }).where(eq(studyBlock.id, block.id));
  return "armed";
}

/** An armed block, as the drive that claims it needs it. */
export interface ArmedBlock {
  id: string;
  position: number;
  display: ConversationDisplay;
  task: string;
  armedAt: Date;
}

/** The block this account armed for its next drive, if any is still waiting. */
export async function armedBlockFor(userId: string, now = new Date()): Promise<ArmedBlock | null> {
  const [row] = await getDb()
    .select({
      id: studyBlock.id,
      position: studyBlock.position,
      display: studyBlock.display,
      task: studyBlock.task,
      armedAt: studyBlock.armedAt,
    })
    .from(studyBlock)
    .innerJoin(studySession, eq(studySession.id, studyBlock.sessionId))
    .where(
      and(
        eq(studySession.userId, userId),
        isNull(studySession.completedAt),
        isNull(studyBlock.finishedAt),
        gt(studyBlock.armedAt, new Date(now.getTime() - ARM_TTL_MS)),
      ),
    )
    .orderBy(desc(studyBlock.armedAt))
    .limit(1);
  return row?.armedAt ? { ...row, display: Display.parse(row.display), armedAt: row.armedAt } : null;
}

/**
 * The drive has registered under the armed block's condition: link the two,
 * disarm, and count the start (`attempts`). Only if still armed as read — of
 * two drives racing for one arm (two tabs), one links and the other is logged
 * by the caller.
 */
export async function linkArmedBlock(block: ArmedBlock, captureSessionId: string): Promise<boolean> {
  const linked = await getDb()
    .update(studyBlock)
    .set({ captureSessionId, armedAt: null, attempts: sql`${studyBlock.attempts} + 1` })
    .where(and(eq(studyBlock.id, block.id), eq(studyBlock.armedAt, block.armedAt)))
    .returning({ id: studyBlock.id });
  return linked.length > 0;
}

/** The block a drive is, for the routes that set up its agent. Null for every other drive. */
export async function findBlockByCaptureSession(
  captureSessionId: string,
): Promise<{ position: number; display: ConversationDisplay; task: string } | null> {
  const [row] = await getDb()
    .select({ position: studyBlock.position, display: studyBlock.display, task: studyBlock.task })
    .from(studyBlock)
    .where(eq(studyBlock.captureSessionId, captureSessionId))
    .limit(1);
  // A block from before the views were renamed holds the old name.
  return row ? { ...row, display: Display.parse(row.display) } : null;
}

async function ownBlock(userId: string, position: number): Promise<StudyBlock | null> {
  const [row] = await getDb()
    .select({ block: studyBlock })
    .from(studyBlock)
    .innerJoin(studySession, eq(studySession.id, studyBlock.sessionId))
    .where(and(eq(studySession.userId, userId), eq(studyBlock.position, position)))
    .orderBy(desc(studySession.createdAt))
    .limit(1);
  return row?.block ?? null;
}

/** Whether this drive is the block's: the page checks before trusting the conversation it shows. */
export async function blockLinked(userId: string, position: number, captureSessionId: string): Promise<boolean> {
  const block = await ownBlock(userId, position);
  return block?.captureSessionId === captureSessionId;
}

/** They finished the block's conversation. Only once it has one; the first time stands. */
export async function finishBlock(userId: string, position: number, now = new Date()): Promise<boolean> {
  const block = await ownBlock(userId, position);
  if (!block?.captureSessionId) return false;
  if (block.finishedAt) return true;
  await getDb()
    .update(studyBlock)
    .set({ finishedAt: now })
    .where(and(eq(studyBlock.id, block.id), isNull(studyBlock.finishedAt)));
  return true;
}

export type MomentResult = "saved" | "duplicate" | "no_drive";

/**
 * Something that happened during the block's conversation, filed with the
 * block's current drive. The first one sent for a kind and ordinal stands: a
 * retry is a duplicate, not a second answer. Accepted after Finish too — a
 * prompt can expire, and a resumption end unanswered, as the drive closes.
 */
export async function saveMoment(userId: string, position: number, moment: SessionMoment): Promise<MomentResult> {
  const block = await ownBlock(userId, position);
  if (!block?.captureSessionId) return "no_drive";
  const inserted = await getDb()
    .insert(studyMoment)
    .values({
      blockId: block.id,
      captureSessionId: block.captureSessionId,
      kind: moment.kind,
      ordinal: moment.ordinal,
      item: moment.item,
      shownOffsetMs: moment.shownOffsetMs,
      answeredOffsetMs: moment.answeredOffsetMs,
      value: moment.value,
      text: moment.text,
      meta: moment.meta ?? {},
    })
    .onConflictDoNothing({ target: [studyMoment.captureSessionId, studyMoment.kind, studyMoment.ordinal] })
    .returning({ id: studyMoment.id });
  return inserted.length > 0 ? "saved" : "duplicate";
}

export type AnswerResult = "saved" | "no_block" | "not_finished";

/** What they answered after the block. Only after it was finished; the first answer stands. */
export async function saveBlockAnswers(
  userId: string,
  position: number,
  answers: BlockAnswers,
  now = new Date(),
): Promise<AnswerResult> {
  const block = await ownBlock(userId, position);
  if (!block) return "no_block";
  if (!block.finishedAt) return "not_finished";
  const { summary, ...rest } = answers;
  // With the version of the questions, so answers to changed ones are never pooled.
  await getDb()
    .update(studyBlock)
    .set({ summary, answers: { ...rest, version: SESSION_VERSION }, answeredAt: now })
    .where(and(eq(studyBlock.id, block.id), isNull(studyBlock.answeredAt)));
  return "saved";
}

export type FinalResult = "saved" | "no_session" | "not_done";

/** The last questions, which complete the session. Only once its conversation is answered; the first one stands. */
export async function saveFinal(userId: string, final: SessionFinal, now = new Date()): Promise<FinalResult> {
  const state = await findSessionByUser(userId);
  if (!state?.session.consentedAt) return "no_session";
  if (state.session.completedAt) return "saved";
  if (state.blocks.some((b) => !b.answeredAt)) return "not_done";
  await getDb()
    .update(studySession)
    .set({ final: { ...final, version: SESSION_VERSION }, completedAt: now })
    .where(and(eq(studySession.id, state.session.id), isNull(studySession.completedAt), isNotNull(studySession.consentedAt)));
  return "saved";
}

/* ---------------------------------------------------------------------------
 * Reading a block's drive back, for the export and the judge
 * ------------------------------------------------------------------------- */

export type StudyMoment = typeof studyMoment.$inferSelect;

/** One line of a drive, either side's, on its clock. */
export interface DriveLine {
  who: "user" | "agent";
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Everything said in a drive, both sides, in order: their utterances from
 * the ledger and the agent's turns. On a tie the person comes first.
 */
export async function loadDriveLines(captureSessionId: string): Promise<DriveLine[]> {
  const db = getDb();
  const [theirs, agents] = await Promise.all([
    db
      .select({ startMs: utterance.startOffsetMs, endMs: utterance.endOffsetMs, text: utterance.text })
      .from(utterance)
      .where(eq(utterance.captureSessionId, captureSessionId)),
    db
      .select({ startMs: agentTurn.startOffsetMs, endMs: agentTurn.endOffsetMs, text: agentTurn.text })
      .from(agentTurn)
      .where(eq(agentTurn.captureSessionId, captureSessionId)),
  ]);
  const lines: DriveLine[] = [
    ...theirs.map((u) => ({ who: "user" as const, ...u })),
    ...agents.map((a) => ({ who: "agent" as const, startMs: a.startMs, endMs: a.endMs, text: a.text })),
  ];
  return lines.sort((a, b) => a.startMs - b.startMs || (a.who === b.who ? 0 : a.who === "user" ? -1 : 1));
}

/** One visit to a subject of a drive: open (`endMs` null) while the talk was still on it. */
export interface SubjectVisitRow {
  ordinal: number;
  title: string;
  startMs: number;
  endMs: number | null;
}

/** The visits to a drive's subjects, in order. Titles are content: for the researchers' files only. */
export async function loadSubjectVisits(captureSessionId: string): Promise<SubjectVisitRow[]> {
  return getDb()
    .select({
      ordinal: driveSubject.ordinal,
      title: driveSubject.title,
      startMs: driveSubjectSegment.startOffsetMs,
      endMs: driveSubjectSegment.endOffsetMs,
    })
    .from(driveSubjectSegment)
    .innerJoin(driveSubject, eq(driveSubject.id, driveSubjectSegment.driveSubjectId))
    .where(eq(driveSubject.captureSessionId, captureSessionId))
    .orderBy(asc(driveSubjectSegment.startOffsetMs));
}

/** The moments of these drives, each drive's in the order they were shown. */
export async function loadMoments(captureSessionIds: readonly string[]): Promise<StudyMoment[]> {
  if (captureSessionIds.length === 0) return [];
  return getDb()
    .select()
    .from(studyMoment)
    .where(inArray(studyMoment.captureSessionId, [...captureSessionIds]))
    .orderBy(asc(studyMoment.captureSessionId), asc(studyMoment.shownOffsetMs));
}
