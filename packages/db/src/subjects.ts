import { driveSubject, driveSubjectSegment, keepViaEnum, sparkKindEnum, subjectSignal } from "./schema";
import { and, eq, getDb, sql } from "./index";

/**
 * The subjects of a drive, as the voice container names them, and the visits
 * to each. See `drive_subject` in the schema.
 *
 * ONE WRITE PER TURN OF THE TALK. The container posts the subject it turned to
 * (with its title, every time) and, when it turns away, the visit it left. So
 * a subject is created by whichever post reaches here first, and a visit is
 * opened and later closed by two posts with the same start — order-proof, and
 * a retried post is a no-op.
 */

export interface SubjectVisit {
  captureSessionId: string;
  ordinal: number;
  /** Content: stored on the subject, never exported, never logged. */
  title: string;
  startOffsetMs: number;
  /** Absent while the visit is still open. */
  endOffsetMs?: number;
}

/** The longest title kept, as for `capture_session.title`. */
const MAX_SUBJECT_TITLE_CHARS = 120;

export async function recordSubjectVisit(visit: SubjectVisit): Promise<void> {
  const title = visit.title.replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT_TITLE_CHARS);
  await getDb().transaction(async (tx) => {
    await tx
      .insert(driveSubject)
      .values({
        captureSessionId: visit.captureSessionId,
        ordinal: visit.ordinal,
        title: title || "…",
        firstOffsetMs: visit.startOffsetMs,
      })
      .onConflictDoNothing({ target: [driveSubject.captureSessionId, driveSubject.ordinal] });
    const [subject] = await tx
      .select({ id: driveSubject.id })
      .from(driveSubject)
      .where(
        and(
          eq(driveSubject.captureSessionId, visit.captureSessionId),
          eq(driveSubject.ordinal, visit.ordinal),
        ),
      )
      .limit(1);
    if (!subject) return;
    await tx
      .insert(driveSubjectSegment)
      .values({
        driveSubjectId: subject.id,
        startOffsetMs: visit.startOffsetMs,
        endOffsetMs: visit.endOffsetMs ?? null,
      })
      .onConflictDoUpdate({
        target: [driveSubjectSegment.driveSubjectId, driveSubjectSegment.startOffsetMs],
        // An opening post arriving after the closing one must not reopen it.
        set: {
          endOffsetMs: sql`coalesce(excluded.end_offset_ms, ${driveSubjectSegment.endOffsetMs})`,
        },
      });
  });
}

/** One subject's signal as the recorder posts it. See `subject_signal`. */
export interface SubjectSignalRecord {
  ordinal: number;
  userWords: number;
  agentWords: number;
  pauses: number;
  pausesBefore: number;
  fillers: number;
  selfRepairs: number;
  hedges: number;
  settled: boolean | null;
  fade: number;
  sparksShown: (typeof sparkKindEnum.enumValues)[number][];
  sparksPulled: (typeof sparkKindEnum.enumValues)[number][];
  /** Kept in their own head; how; when. Absent from an older recorder: not kept. */
  kept?: boolean;
  keptVia?: (typeof keepViaEnum.enumValues)[number] | null;
  keptAt?: Date | null;
}

/**
 * Keep the recorder's signals for a drive's subjects. Last write wins, with
 * two exceptions: a best-effort write (page hidden) never replaces the one
 * Stop made (`final`), and a judgement the browser had never heard of is not
 * erased by a later write without one.
 *
 * Only subjects the container has already kept get a row: an ordinal with no
 * `drive_subject` is skipped, and the number skipped is returned.
 */
export async function saveSubjectSignals(
  captureSessionId: string,
  signals: SubjectSignalRecord[],
  options: { final: boolean; signalsVersion?: string },
): Promise<{ saved: number; skipped: number }> {
  if (signals.length === 0) return { saved: 0, skipped: 0 };
  const db = getDb();
  const subjects = await db
    .select({ id: driveSubject.id, ordinal: driveSubject.ordinal })
    .from(driveSubject)
    .where(eq(driveSubject.captureSessionId, captureSessionId));
  const byOrdinal = new Map(subjects.map((s) => [s.ordinal, s.id]));

  let saved = 0;
  let skipped = 0;
  for (const signal of signals) {
    const driveSubjectId = byOrdinal.get(signal.ordinal);
    if (!driveSubjectId) {
      skipped += 1;
      continue;
    }
    const { ordinal: _ordinal, kept, keptVia, keptAt, ...counts } = signal;
    const values = {
      ...counts,
      // A keep is all three or none: no "kept" without how, no how without it.
      kept: kept === true,
      keptVia: kept === true ? (keptVia ?? null) : null,
      keptAt: kept === true ? (keptAt ?? null) : null,
      driveSubjectId,
      final: options.final,
      signalsVersion: options.signalsVersion ?? null,
      updatedAt: new Date(),
    };
    const written = await db
      .insert(subjectSignal)
      .values(values)
      .onConflictDoUpdate({
        target: subjectSignal.driveSubjectId,
        set: {
          ...values,
          settled: sql`coalesce(excluded.settled, ${subjectSignal.settled})`,
        },
        setWhere: sql`${subjectSignal.final} = false or excluded.final = true`,
      })
      .returning({ id: subjectSignal.id });
    saved += written.length;
  }
  return { saved, skipped };
}
