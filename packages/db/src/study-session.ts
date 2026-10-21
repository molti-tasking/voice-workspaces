import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  SESSION_ORDERS,
  SESSION_VERSION,
  blocksFor,
  type BlockAnswers,
  type ConversationDisplay,
  type SessionFinal,
  type SessionProgress,
} from "@voicemural/shared";
import { studyBlock, studySession, user } from "./schema";
import { getDb } from "./index";

/**
 * The display study's sessions and their blocks (`study_session`,
 * `study_block`; `study-session.ts` in @voicemural/shared).
 *
 * A session is made by a researcher before anyone sees it, claimed by the
 * account that consents on its link, and then walked through block by block:
 * armed, talked (the drive links itself when it registers), finished and
 * answered — and at the end, ranked.
 *
 * Every write here is first-one-stands, as in the Prolific study: a reload, a
 * double tap or a second tab must never overwrite an answer already given.
 */

export type StudySession = typeof studySession.$inferSelect;
export type StudyBlock = typeof studyBlock.$inferSelect;

export interface SessionWithBlocks {
  session: StudySession;
  /** In position order. */
  blocks: StudyBlock[];
}

/** Pseudonyms of invited participants: F01, F02, … (F for formative). */
export const SESSION_REF_PREFIX = "F";

/**
 * How long an armed block waits for its drive. The page arms it a moment
 * before it starts the recorder; one still armed an hour later is a page that
 * was closed, and must not capture the next drive this account makes.
 */
export const ARM_TTL_MS = 15 * 60_000;

/**
 * A new session with its four blocks, ready to be sent as a link.
 *
 * The order is the next in turn (sessions made so far, modulo the orders),
 * so a handful of invites is as balanced as it can be; `orderIndex` pins it.
 * Under a transaction-scoped advisory lock, so two invites made at once
 * cannot take the same pseudonym or the same turn.
 */
export async function createSession(input: { ref?: string; orderIndex?: number } = {}): Promise<SessionWithBlocks> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('study_session'))`);

    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(studySession)) as [{ n: number }];
    const orderIndex = input.orderIndex ?? n % SESSION_ORDERS;

    let ref = input.ref;
    if (ref === undefined) {
      const [{ last }] = (await tx
        .select({ last: sql<number | null>`max(substring(${studySession.ref} from 2)::int)` })
        .from(studySession)
        .where(sql`${studySession.ref} ~ ${`^${SESSION_REF_PREFIX}[0-9]+$`}`)) as [{ last: number | null }];
      ref = SESSION_REF_PREFIX + String((last ?? 0) + 1).padStart(2, "0");
    } else {
      const [taken] = await tx.select({ id: studySession.id }).from(studySession).where(eq(studySession.ref, ref)).limit(1);
      if (taken) throw new Error(`the pseudonym ${ref} is taken`);
    }

    const [session] = await tx
      .insert(studySession)
      .values({ ref, orderIndex, inviteCode: randomBytes(18).toString("base64url") })
      .returning();
    const blocks = await tx
      .insert(studyBlock)
      .values(blocksFor(orderIndex).map((b) => ({ sessionId: session!.id, ...b })))
      .returning();
    return { session: session!, blocks: blocks.sort((a, b) => a.position - b.position) };
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

export async function findSessionByUser(userId: string): Promise<SessionWithBlocks | null> {
  const [session] = await getDb()
    .select()
    .from(studySession)
    .where(eq(studySession.userId, userId))
    .orderBy(desc(studySession.createdAt))
    .limit(1);
  return withBlocks(session);
}

/** Every session, oldest first, for the researchers' commands. */
export async function listSessions(): Promise<SessionWithBlocks[]> {
  const sessions = await getDb().select().from(studySession).orderBy(asc(studySession.createdAt));
  const blocks = await getDb().select().from(studyBlock).orderBy(asc(studyBlock.position));
  return sessions.map((session) => ({ session, blocks: blocks.filter((b) => b.sessionId === session.id) }));
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
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('study_session'))`);

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
  return row?.armedAt ? { ...row, armedAt: row.armedAt } : null;
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
  return row ?? null;
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

/** The ranking, which completes the session. Only after all four blocks; the first one stands. */
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
