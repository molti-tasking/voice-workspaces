import { createHash } from "node:crypto";
import { chooseArm, type ProlificArm, type ProlificClosing } from "@voicemural/shared";
import { scheduleRecallProbes } from "./recall";
import { prolificParticipant, user } from "./schema";
import { and, eq, getDb, isNull, sql } from "./index";

/**
 * The Prolific recall study's participants (PROLIFIC.md, `prolific_participant`).
 *
 * A participant is a guest account plus this row. Enrolment assigns the arm,
 * writes it onto the account as the study condition its drives copy
 * (`user.study_condition`), and gives the account a pseudonym so the existing
 * `study:export` and `study:metrics` pick the participant up like any other.
 *
 * Every write here is first-one-stands: a reload, a double tap or a second
 * tab must never overwrite an answer already given.
 */

export type ProlificParticipant = typeof prolificParticipant.$inferSelect;

/** What `isRealProlificPid` checks, as a Postgres regex for the arm counts. */
const REAL_PID_PATTERN = "^[0-9a-f]{24}$";

/** Pseudonyms of Prolific participants start with this, so the analysis can tell them apart. */
export const PROLIFIC_PSEUDONYM_PREFIX = "PRO-";

/**
 * The pseudonym for a PID: stable, short, and not the PID itself, which is
 * kept only on `prolific_participant` where the payments need it.
 */
export function pseudonymFor(pid: string): string {
  return PROLIFIC_PSEUDONYM_PREFIX + createHash("sha256").update(pid).digest("hex").slice(0, 10);
}

export async function findParticipantByPid(pid: string): Promise<ProlificParticipant | null> {
  const [row] = await getDb()
    .select()
    .from(prolificParticipant)
    .where(eq(prolificParticipant.prolificPid, pid))
    .limit(1);
  return row ?? null;
}

export async function findParticipantByUser(userId: string): Promise<ProlificParticipant | null> {
  const [row] = await getDb()
    .select()
    .from(prolificParticipant)
    .where(eq(prolificParticipant.userId, userId))
    .limit(1);
  return row ?? null;
}

export type EnrollResult =
  | { ok: true; participant: ProlificParticipant; created: boolean }
  /** This PID's conversation began on another account: part 1 cannot start over. */
  | { ok: false; reason: "enrolled_elsewhere" }
  /** This account already belongs to another PID: the browser needs a fresh guest. */
  | { ok: false; reason: "other_participant" }
  /**
   * A signed-in account, not a guest: a researcher opening the study in their
   * everyday browser. Never enrolled — it would switch off their board and
   * file their account under a participant's pseudonym.
   */
  | { ok: false; reason: "not_a_guest" };

/**
 * Enrol a PID on a guest account, or find its enrolment.
 *
 * - Same PID, same account: the existing row, unchanged (a reload).
 * - Same PID, another account, conversation not started yet: moved onto this
 *   account (they opened the link in a second browser before starting).
 * - Same PID, conversation already started elsewhere: refused.
 *
 * The arm is chosen under a transaction-scoped advisory lock, so two people
 * enrolling at the same moment cannot both see the same counts.
 */
export async function enrollParticipant(input: {
  pid: string;
  userId: string;
  task: string;
  recallDelayHours: number;
  studyId?: string;
  sessionId?: string;
  /** Pinned by a researcher outside production; otherwise balanced. */
  arm?: ProlificArm;
  random?: () => number;
  now?: Date;
}): Promise<EnrollResult> {
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('prolific_participant'))`);

    const [account] = await tx
      .select({ isAnonymous: user.isAnonymous })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!account?.isAnonymous) return { ok: false, reason: "not_a_guest" };

    const [mine] = await tx
      .select()
      .from(prolificParticipant)
      .where(eq(prolificParticipant.userId, input.userId))
      .limit(1);
    if (mine && mine.prolificPid !== input.pid) return { ok: false, reason: "other_participant" };

    const [existing] = await tx
      .select()
      .from(prolificParticipant)
      .where(eq(prolificParticipant.prolificPid, input.pid))
      .limit(1);

    if (existing) {
      if (existing.userId === input.userId) {
        return { ok: true, participant: existing, created: false };
      }
      if (existing.captureSessionId !== null || existing.part1CompletedAt !== null) {
        return { ok: false, reason: "enrolled_elsewhere" };
      }
      // Moved before anything was recorded: the old guest keeps nothing of the
      // study, and the pseudonym (unique) moves with the participant.
      await tx.update(user).set({ studyParticipantId: null, studyCondition: null }).where(eq(user.id, existing.userId));
      await tx
        .update(user)
        .set({
          studyParticipantId: pseudonymFor(input.pid),
          studyCondition: { sparks: existing.arm === "sparks" },
          boardEnabledAt: null,
          updatedAt: now,
        })
        .where(eq(user.id, input.userId));
      const [moved] = await tx
        .update(prolificParticipant)
        .set({ userId: input.userId })
        .where(eq(prolificParticipant.id, existing.id))
        .returning();
      return { ok: true, participant: moved!, created: false };
    }

    // Balanced over real participants only: a researcher's test runs on the
    // live site must not decide which arm the next real person gets.
    const counts = { control: 0, sparks: 0 };
    const rows = await tx
      .select({ arm: prolificParticipant.arm, n: sql<number>`count(*)::int` })
      .from(prolificParticipant)
      .where(sql`${prolificParticipant.prolificPid} ~ ${REAL_PID_PATTERN}`)
      .groupBy(prolificParticipant.arm);
    for (const row of rows) counts[row.arm] = row.n;
    const arm = input.arm ?? chooseArm(counts, input.random);

    const [created] = await tx
      .insert(prolificParticipant)
      .values({
        prolificPid: input.pid,
        userId: input.userId,
        arm,
        task: input.task,
        recallDelayHours: input.recallDelayHours,
        part1StudyId: input.studyId ?? null,
        part1SessionId: input.sessionId ?? null,
        consentedAt: now,
      })
      .returning();
    // The condition every drive of theirs copies at insert. Only the sparks
    // vary; everything else stays at the defaults both arms share. No board:
    // a participant never sees one, and an agent with board tools would offer
    // to move cards nobody can look at.
    await tx
      .update(user)
      .set({
        studyParticipantId: pseudonymFor(input.pid),
        studyCondition: { sparks: arm === "sparks" },
        boardEnabledAt: null,
        updatedAt: now,
      })
      .where(eq(user.id, input.userId));
    return { ok: true, participant: created!, created: true };
  });
}

/**
 * Which drive is the conversation. The latest one started before part 1 is
 * finished: a participant who reloads mid-conversation and starts again is
 * asked about the conversation they finished, not the one they abandoned.
 */
export async function markConversationStarted(
  userId: string,
  captureSessionId: string,
): Promise<boolean> {
  const updated = await getDb()
    .update(prolificParticipant)
    .set({ captureSessionId })
    .where(and(eq(prolificParticipant.userId, userId), isNull(prolificParticipant.part1CompletedAt)))
    .returning({ id: prolificParticipant.id });
  return updated.length > 0;
}

/**
 * The end of part 1: their judgement of learning, and the drive's recall
 * probes scheduled (idempotent — Stop's final signals may have done it
 * already). Refused before a conversation exists. The first answer stands.
 */
export async function finishPart1(
  userId: string,
  judgmentOfLearning: number,
  now = new Date(),
): Promise<ProlificParticipant | null> {
  const participant = await findParticipantByUser(userId);
  if (!participant?.captureSessionId) return null;
  if (participant.part1CompletedAt === null) {
    await getDb()
      .update(prolificParticipant)
      .set({ part1CompletedAt: now, judgmentOfLearning })
      .where(and(eq(prolificParticipant.id, participant.id), isNull(prolificParticipant.part1CompletedAt)));
  }
  await scheduleRecallProbes(participant.captureSessionId, { now });
  return findParticipantByUser(userId);
}

/** When part 2 opens for them: the end of part 1 plus their recall delay. Null before part 1 ends. */
export function part2OpensAt(participant: ProlificParticipant): Date | null {
  if (!participant.part1CompletedAt) return null;
  return new Date(participant.part1CompletedAt.getTime() + participant.recallDelayHours * 3_600_000);
}

export type Part2State =
  | { state: "unknown" }
  | { state: "part1_unfinished" }
  | { state: "too_early"; opensAt: Date }
  | { state: "open"; participant: ProlificParticipant };

/** Whether a PID may do part 2 now. */
export async function part2StateFor(pid: string, now = new Date()): Promise<Part2State> {
  const participant = await findParticipantByPid(pid);
  if (!participant) return { state: "unknown" };
  const opensAt = part2OpensAt(participant);
  if (!opensAt) return { state: "part1_unfinished" };
  if (opensAt.getTime() > now.getTime()) return { state: "too_early", opensAt };
  return { state: "open", participant };
}

/** The first visit to part 2, with Prolific's ids for it. Later visits change nothing. */
export async function beginPart2(
  participantId: string,
  refs: { studyId?: string; sessionId?: string },
  now = new Date(),
): Promise<void> {
  await getDb()
    .update(prolificParticipant)
    .set({ part2StartedAt: now, part2StudyId: refs.studyId ?? null, part2SessionId: refs.sessionId ?? null })
    .where(and(eq(prolificParticipant.id, participantId), isNull(prolificParticipant.part2StartedAt)));
}

/** The free recall. The first one stands: once they have seen the probes, a new one would be cued. */
export async function saveFreeRecall(
  participantId: string,
  text: string,
  confidence: number,
  now = new Date(),
): Promise<boolean> {
  const updated = await getDb()
    .update(prolificParticipant)
    .set({ freeRecall: text, freeRecallConfidence: confidence, freeRecallAt: now })
    .where(and(eq(prolificParticipant.id, participantId), isNull(prolificParticipant.freeRecallAt)))
    .returning({ id: prolificParticipant.id });
  return updated.length > 0;
}

/** The closing questions, which complete part 2. Only after the free recall. */
export async function saveClosing(
  participantId: string,
  answers: ProlificClosing,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ freeRecallAt: prolificParticipant.freeRecallAt, done: prolificParticipant.part2CompletedAt })
    .from(prolificParticipant)
    .where(eq(prolificParticipant.id, participantId))
    .limit(1);
  if (!row?.freeRecallAt) return false;
  if (row.done) return true;
  await db
    .update(prolificParticipant)
    .set({ closing: answers, part2CompletedAt: now })
    .where(and(eq(prolificParticipant.id, participantId), isNull(prolificParticipant.part2CompletedAt)));
  return true;
}

/** Every participant, for `pnpm study:prolific`. */
export async function listParticipants(): Promise<ProlificParticipant[]> {
  return getDb().select().from(prolificParticipant).orderBy(prolificParticipant.createdAt);
}
