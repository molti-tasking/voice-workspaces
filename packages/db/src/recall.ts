import {
  agentTurn,
  captureSession,
  driveSubject,
  driveSubjectSegment,
  recallProbe,
  recallProvenanceEnum,
  subjectSignal,
  utterance,
} from "./schema";
import { and, asc, eq, getDb, gte, isNotNull, isNull, lte, sql } from "./index";

/**
 * The recall probe: a couple of days after a drive, a few of its subjects,
 * asked back. See `recall_probe` in the schema for what is kept (numbers and
 * an enum) and what never is (their words).
 *
 * WHICH SUBJECTS. Up to three per drive: every one they pulled a spark on, up
 * to two, and the rest of the three drawn at random from the others — so the
 * pulled and the unpulled can be compared, and so the control arm, which pulls
 * nothing, still gets three.
 *
 * WHEN. `RECALL_DELAY_HOURS` after the drive ended. Scheduled at Stop, when the
 * recorder posts its final signals; and lazily for a drive that ended without
 * one (closed by the idle sweep), the first time the person's due probes are
 * looked up.
 */

/** How long after a drive its subjects are asked back. An open study decision: 48 h or 7 days. */
export const RECALL_DELAY_HOURS = 48;
/** At most this many subjects per drive. */
export const RECALL_SUBJECTS_PER_DRIVE = 3;
/** Of which at most this many are ones a spark was pulled on. */
export const RECALL_PULLED_PER_DRIVE = 2;
/** A drive older than this when first looked at is not asked about at all. */
const RECALL_LOOKBACK_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type RecallProvenance = (typeof recallProvenanceEnum.enumValues)[number];

/** `n` of `items`, in random order. `random` is injectable for the tests. */
function sample<T>(items: T[], n: number, random: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < n && pool.length > 0) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return picked;
}

/**
 * Choose a drive's subjects and schedule them. Idempotent: a drive that
 * already has probes is left as it is. Returns how many were scheduled.
 */
export async function scheduleRecallProbes(
  captureSessionId: string,
  options: { now?: Date; random?: () => number } = {},
): Promise<number> {
  const db = getDb();
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  const [session] = await db
    .select({ userId: captureSession.userId, endedAt: captureSession.endedAt })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (!session) return 0;

  const subjects = await db
    .select({
      id: driveSubject.id,
      pulled: subjectSignal.sparksPulled,
      probe: recallProbe.id,
    })
    .from(driveSubject)
    .leftJoin(subjectSignal, eq(subjectSignal.driveSubjectId, driveSubject.id))
    .leftJoin(recallProbe, eq(recallProbe.driveSubjectId, driveSubject.id))
    .where(eq(driveSubject.captureSessionId, captureSessionId));
  if (subjects.length === 0 || subjects.some((s) => s.probe !== null)) return 0;

  const pulled = subjects.filter((s) => (s.pulled?.length ?? 0) > 0);
  const chosen = sample(pulled, RECALL_PULLED_PER_DRIVE, random);
  const rest = subjects.filter((s) => !chosen.includes(s));
  chosen.push(...sample(rest, RECALL_SUBJECTS_PER_DRIVE - chosen.length, random));

  const dueAt = new Date((session.endedAt ?? now).getTime() + RECALL_DELAY_HOURS * HOUR_MS);
  const inserted = await db
    .insert(recallProbe)
    .values(chosen.map((s) => ({ userId: session.userId, driveSubjectId: s.id, dueAt })))
    .onConflictDoNothing({ target: recallProbe.driveSubjectId })
    .returning({ id: recallProbe.id });
  return inserted.length;
}

/** Schedule every recent ended drive of theirs that has subjects and no probes yet. */
export async function scheduleMissedRecallProbes(userId: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - RECALL_LOOKBACK_DAYS * DAY_MS);
  const drives = await getDb()
    .selectDistinct({ id: captureSession.id })
    .from(captureSession)
    .innerJoin(driveSubject, eq(driveSubject.captureSessionId, captureSession.id))
    .leftJoin(recallProbe, eq(recallProbe.driveSubjectId, driveSubject.id))
    .where(
      and(
        eq(captureSession.userId, userId),
        isNotNull(captureSession.endedAt),
        gte(captureSession.endedAt, since),
        isNull(recallProbe.id),
      ),
    );
  for (const drive of drives) await scheduleRecallProbes(drive.id, { now });
}

export interface DueProbe {
  id: string;
  /** Content: the subject's name, shown back to its owner only. */
  title: string;
  captureSessionId: string;
  driveStartedAt: Date;
  /** Already rated, before they saw their words: the reveal comes next. */
  confidence: number | null;
}

/** Their probes that are due and not yet answered, the oldest drive first. */
export async function loadDueProbes(userId: string, now = new Date()): Promise<DueProbe[]> {
  return getDb()
    .select({
      id: recallProbe.id,
      title: driveSubject.title,
      captureSessionId: driveSubject.captureSessionId,
      driveStartedAt: captureSession.startedAt,
      confidence: recallProbe.confidence,
    })
    .from(recallProbe)
    .innerJoin(driveSubject, eq(driveSubject.id, recallProbe.driveSubjectId))
    .innerJoin(captureSession, eq(captureSession.id, driveSubject.captureSessionId))
    .where(
      and(
        eq(recallProbe.userId, userId),
        isNull(recallProbe.answeredAt),
        lte(recallProbe.dueAt, now),
      ),
    )
    .orderBy(asc(captureSession.startedAt), asc(driveSubject.ordinal));
}

export interface SubjectLine {
  who: "user" | "agent";
  offsetMs: number;
  text: string;
}

/**
 * What was said on one subject: their utterances and the agent's turns that
 * started inside its visits, in order. A visit still open when the container
 * last wrote ends where the next visit to any subject began, or at the end
 * of the drive.
 *
 * Owned: null unless the probe is theirs. Content, for their eyes only, and
 * only once they have rated how well they remember it (`confidence`), which
 * the caller checks.
 */
export async function loadProbeSpeech(
  probeId: string,
  userId: string,
): Promise<{ probe: DueProbe; lines: SubjectLine[] } | null> {
  const db = getDb();
  const [probe] = await db
    .select({
      id: recallProbe.id,
      title: driveSubject.title,
      captureSessionId: driveSubject.captureSessionId,
      driveStartedAt: captureSession.startedAt,
      driveEndedAt: captureSession.endedAt,
      confidence: recallProbe.confidence,
      driveSubjectId: recallProbe.driveSubjectId,
    })
    .from(recallProbe)
    .innerJoin(driveSubject, eq(driveSubject.id, recallProbe.driveSubjectId))
    .innerJoin(captureSession, eq(captureSession.id, driveSubject.captureSessionId))
    .where(and(eq(recallProbe.id, probeId), eq(recallProbe.userId, userId)))
    .limit(1);
  if (!probe) return null;

  const visits = await db
    .select({
      subjectId: driveSubjectSegment.driveSubjectId,
      start: driveSubjectSegment.startOffsetMs,
      end: driveSubjectSegment.endOffsetMs,
    })
    .from(driveSubjectSegment)
    .innerJoin(driveSubject, eq(driveSubject.id, driveSubjectSegment.driveSubjectId))
    .where(eq(driveSubject.captureSessionId, probe.captureSessionId))
    .orderBy(asc(driveSubjectSegment.startOffsetMs));

  const driveEnd = probe.driveEndedAt
    ? probe.driveEndedAt.getTime() - probe.driveStartedAt.getTime()
    : Number.MAX_SAFE_INTEGER;
  const ranges = visits.flatMap((v, i) => {
    if (v.subjectId !== probe.driveSubjectId) return [];
    const next = visits[i + 1]?.start;
    return [{ start: v.start, end: v.end ?? next ?? driveEnd }];
  });

  const { driveSubjectId: _id, driveEndedAt: _ended, ...head } = probe;
  if (ranges.length === 0) return { probe: head, lines: [] };

  const within = (column: typeof utterance.startOffsetMs | typeof agentTurn.startOffsetMs) =>
    sql.join(
      ranges.map((r) => sql`(${column} >= ${r.start} and ${column} < ${r.end})`),
      sql` or `,
    );
  const [theirs, agents] = await Promise.all([
    db
      .select({ offsetMs: utterance.startOffsetMs, text: utterance.text })
      .from(utterance)
      .where(
        and(eq(utterance.captureSessionId, probe.captureSessionId), sql`(${within(utterance.startOffsetMs)})`),
      ),
    db
      .select({ offsetMs: agentTurn.startOffsetMs, text: agentTurn.text })
      .from(agentTurn)
      .where(
        and(eq(agentTurn.captureSessionId, probe.captureSessionId), sql`(${within(agentTurn.startOffsetMs)})`),
      ),
  ]);
  const lines: SubjectLine[] = [
    ...theirs.map((l) => ({ who: "user" as const, ...l })),
    ...agents.map((l) => ({ who: "agent" as const, ...l })),
  ].sort((a, b) => a.offsetMs - b.offsetMs);
  return { probe: head, lines };
}

/**
 * Before the reveal: how well they remember where they landed, 1-7. The first
 * rating stands — once they have seen their words, a new one would measure
 * the words, not their memory. False when nothing was changed.
 */
export async function rateRecallConfidence(
  probeId: string,
  userId: string,
  confidence: number,
): Promise<boolean> {
  const updated = await getDb()
    .update(recallProbe)
    .set({ confidence })
    .where(
      and(
        eq(recallProbe.id, probeId),
        eq(recallProbe.userId, userId),
        isNull(recallProbe.answeredAt),
        isNull(recallProbe.confidence),
      ),
    )
    .returning({ id: recallProbe.id });
  return updated.length > 0;
}

/**
 * After the reveal: how close they were, and whose idea it mostly was. Only
 * once confidence is in, so the order the measure depends on is enforced here
 * and not only by the page.
 */
export async function answerRecallProbe(
  probeId: string,
  userId: string,
  answer: { selfAccuracy: number; provenance: RecallProvenance },
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ endedAt: captureSession.endedAt, startedAt: captureSession.startedAt })
    .from(recallProbe)
    .innerJoin(driveSubject, eq(driveSubject.id, recallProbe.driveSubjectId))
    .innerJoin(captureSession, eq(captureSession.id, driveSubject.captureSessionId))
    .where(and(eq(recallProbe.id, probeId), eq(recallProbe.userId, userId)))
    .limit(1);
  if (!row) return false;
  const since = (row.endedAt ?? row.startedAt).getTime();
  const updated = await db
    .update(recallProbe)
    .set({
      selfAccuracy: answer.selfAccuracy,
      provenance: answer.provenance,
      answeredAt: now,
      delayDays: Math.max(0, Math.floor((now.getTime() - since) / DAY_MS)),
    })
    .where(
      and(
        eq(recallProbe.id, probeId),
        eq(recallProbe.userId, userId),
        isNull(recallProbe.answeredAt),
        isNotNull(recallProbe.confidence),
      ),
    )
    .returning({ id: recallProbe.id });
  return updated.length > 0;
}

/** How many of their probes are due — for the card on other screens. */
export async function countDueProbes(userId: string, now = new Date()): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(recallProbe)
    .where(
      and(eq(recallProbe.userId, userId), isNull(recallProbe.answeredAt), lte(recallProbe.dueAt, now)),
    );
  return row?.n ?? 0;
}
