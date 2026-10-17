import { driveSubject, driveSubjectSegment } from "./schema";
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
