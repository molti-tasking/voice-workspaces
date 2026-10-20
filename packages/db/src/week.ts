import { captureSession, driveSubject, keepViaEnum, recallProbe, subjectSignal } from "./schema";
import { and, asc, eq, getDb, gte, inArray, isNotNull } from "./index";

/**
 * A participant's own week, for `/my-week`: their drives, day by day, each
 * with the mode it ran in and its subjects — which they kept, which Souffleur
 * held, how many sparks they pulled, and whether a recall probe has asked
 * them about it since.
 *
 * THEIRS ONLY. This reads subject TITLES, which the study's exports never
 * carry; it is for the person whose drives they are, behind their session,
 * so they can remember the week before the questionnaire and the interview
 * ask about it. Nothing here is for the researcher.
 */

export type KeepVia = (typeof keepViaEnum.enumValues)[number];

export interface WeekSubject {
  ordinal: number;
  title: string;
  kept: boolean;
  keptVia: KeepVia | null;
  /** Sparks they pulled on it. */
  sparksPulled: number;
  /** Whether a recall probe has asked them about it and been answered. */
  recalled: boolean;
}

export interface WeekDrive {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  /** Who picked what sparks were about on this drive; null when it offered none. */
  mode: "suggested" | "chosen" | null;
  subjects: WeekSubject[];
}

/** The mode a drive ran in, from its frozen condition. */
export function driveMode(condition: unknown): WeekDrive["mode"] {
  const c = (condition ?? {}) as { sparks?: unknown; sparkSelection?: unknown };
  if (c.sparks !== true) return null;
  return c.sparkSelection === "chosen" ? "chosen" : "suggested";
}

/** Their drives since `since`, oldest first, each with its subjects in order. */
export async function loadWeek(userId: string, since: Date): Promise<WeekDrive[]> {
  const db = getDb();
  const sessions = await db
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      studyCondition: captureSession.studyCondition,
    })
    .from(captureSession)
    .where(and(eq(captureSession.userId, userId), gte(captureSession.startedAt, since)))
    .orderBy(asc(captureSession.startedAt));
  if (sessions.length === 0) return [];

  const subjects = await db
    .select({
      id: driveSubject.id,
      sessionId: driveSubject.captureSessionId,
      ordinal: driveSubject.ordinal,
      title: driveSubject.title,
      kept: subjectSignal.kept,
      keptVia: subjectSignal.keptVia,
      sparksPulled: subjectSignal.sparksPulled,
    })
    .from(driveSubject)
    .leftJoin(subjectSignal, eq(subjectSignal.driveSubjectId, driveSubject.id))
    .where(
      inArray(
        driveSubject.captureSessionId,
        sessions.map((s) => s.id),
      ),
    )
    .orderBy(asc(driveSubject.ordinal));

  const recalled = new Set(
    subjects.length === 0
      ? []
      : (
          await db
            .select({ id: recallProbe.driveSubjectId })
            .from(recallProbe)
            .where(
              and(
                inArray(
                  recallProbe.driveSubjectId,
                  subjects.map((s) => s.id),
                ),
                isNotNull(recallProbe.answeredAt),
              ),
            )
        ).map((p) => p.id),
  );

  return sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    mode: driveMode(s.studyCondition),
    subjects: subjects
      .filter((subject) => subject.sessionId === s.id)
      .map((subject) => ({
        ordinal: subject.ordinal,
        title: subject.title,
        kept: subject.kept === true,
        keptVia: subject.keptVia,
        sparksPulled: subject.sparksPulled?.length ?? 0,
        recalled: recalled.has(subject.id),
      })),
  }));
}
