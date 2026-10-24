import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { captureSession, driveSubject, subjectSignal } from "./schema";
import { loadDriveLines, loadSubjectVisits, type DriveLine, type SubjectVisitRow } from "./study-session";
import { getDb } from "./index";

/**
 * A conversation as its page shows it and as Continue picks it up: one drive,
 * or a chain of them where each continued the last (`capture_session.
 * continues_id`). Everything the screen needs to rebuild it with the same
 * views it was shown in live (`replay.ts` in the web app): both sides' lines
 * and the visits to each subject, per drive, and what was judged of each
 * subject.
 *
 * Owned: every drive of the chain is the user's, or it is not read.
 */

export interface ConversationDrive {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  title: string | null;
  lines: DriveLine[];
  visits: SubjectVisitRow[];
  subjects: { ordinal: number; settled: boolean | null; kept: boolean }[];
}

/** At most this many drives in one chain: a guard against a cycle, not a limit anyone reaches. */
const MAX_CHAIN = 50;

/** The ids of the chain `captureSessionId` is part of, first drive first. Empty when it is not theirs. */
export async function conversationChain(userId: string, captureSessionId: string): Promise<string[]> {
  const db = getDb();
  const own = async (id: string) =>
    (
      await db
        .select({ id: captureSession.id, continuesId: captureSession.continuesId })
        .from(captureSession)
        .where(and(eq(captureSession.id, id), eq(captureSession.userId, userId)))
        .limit(1)
    )[0] ?? null;

  const start = await own(captureSessionId);
  if (!start) return [];
  // Back to the first drive.
  const back: string[] = [start.id];
  let at = start;
  while (at.continuesId && back.length < MAX_CHAIN) {
    const previous = await own(at.continuesId);
    if (!previous || back.includes(previous.id)) break;
    back.unshift(previous.id);
    at = previous;
  }
  // On to the latest: of two continuations of one drive, the later started.
  const chain = [...back];
  let last = chain.at(-1)!;
  while (chain.length < MAX_CHAIN) {
    const [next] = await db
      .select({ id: captureSession.id })
      .from(captureSession)
      .where(and(eq(captureSession.continuesId, last), eq(captureSession.userId, userId)))
      .orderBy(desc(captureSession.startedAt))
      .limit(1);
    if (!next || chain.includes(next.id)) break;
    chain.push(next.id);
    last = next.id;
  }
  return chain;
}

/** The whole conversation `captureSessionId` belongs to, drive by drive. Null when it is not theirs. */
export async function loadConversation(userId: string, captureSessionId: string): Promise<ConversationDrive[] | null> {
  const ids = await conversationChain(userId, captureSessionId);
  if (ids.length === 0) return null;
  const db = getDb();
  const [meta, signals] = await Promise.all([
    db
      .select({
        id: captureSession.id,
        startedAt: captureSession.startedAt,
        endedAt: captureSession.endedAt,
        title: captureSession.title,
      })
      .from(captureSession)
      .where(inArray(captureSession.id, ids)),
    db
      .select({
        captureSessionId: driveSubject.captureSessionId,
        ordinal: driveSubject.ordinal,
        settled: subjectSignal.settled,
        kept: subjectSignal.kept,
      })
      .from(subjectSignal)
      .innerJoin(driveSubject, eq(driveSubject.id, subjectSignal.driveSubjectId))
      .where(inArray(driveSubject.captureSessionId, ids))
      .orderBy(asc(driveSubject.ordinal)),
  ]);
  const byId = new Map(meta.map((m) => [m.id, m]));
  return Promise.all(
    ids.map(async (id) => {
      const [lines, visits] = await Promise.all([loadDriveLines(id), loadSubjectVisits(id)]);
      const m = byId.get(id)!;
      return {
        id,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        title: m.title,
        lines,
        visits,
        subjects: signals
          .filter((s) => s.captureSessionId === id)
          .map((s) => ({ ordinal: s.ordinal, settled: s.settled, kept: s.kept })),
      };
    }),
  );
}
