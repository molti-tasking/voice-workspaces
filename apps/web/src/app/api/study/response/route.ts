import { NextResponse } from "next/server";
import { and, captureSession, eq, getDb, isNull, studyResponse } from "@voicemural/db";
import { StudyResponseCreate } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Record one rating: the pre item before a drive, the post items after it.
 *
 * THE MEASURES PILOT 01 HAD NONE OF. Everything that pilot recorded was about
 * the system — latency, turns, decline rate — and every one of those numbers
 * was healthy on a drive where the participant was left waiting in silence and
 * could not get an answer to their own answer. Whether the system RELIEVED
 * them is not derivable from the ledger, so it has to be asked. The wording
 * and the keys live in `@voicemural/shared/study-items`.
 *
 * COUNTS ONLY, by construction. An integer on a stated scale, a phase, an item
 * key — nothing here can carry a sentence, which is what lets the whole table
 * cross the privacy boundary in `study:export` untouched.
 *
 * LAST ANSWER WINS. A participant who taps 4 and then 5 meant 5; the unique
 * index on (user, session, phase, item) turns the second tap into a correction
 * rather than a second data point. A pre/post pair that needed deduplicating
 * in the analysis would be a pair nobody could trust.
 */

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = StudyResponseCreate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const { captureSessionId, phase, item, value, scaleMax } = parsed.data;

  // A rating filed against somebody else's drive would corrupt both records,
  // so the drive is re-resolved rather than trusted. Null is legitimate: the
  // day-7 review is about the week, not about a session.
  if (captureSessionId) {
    const rows = await getDb()
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, captureSessionId))
      .limit(1);
    if (rows[0]?.userId !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const db = getDb();
  const values = {
    userId,
    captureSessionId: captureSessionId ?? null,
    phase,
    item,
    value,
    scaleMax,
  };

  // `onConflictDoUpdate` covers the session-scoped case. A day-7 answer has no
  // session, and Postgres treats two nulls in a unique index as distinct, so
  // that one is corrected by hand — with `isNull` in the predicate, because
  // without it the update would match every drive-scoped row for the same item
  // and rewrite a whole week of pre/post answers with one day-7 rating.
  if (captureSessionId) {
    await db
      .insert(studyResponse)
      .values(values)
      .onConflictDoUpdate({
        target: [
          studyResponse.userId,
          studyResponse.captureSessionId,
          studyResponse.phase,
          studyResponse.item,
        ],
        set: { value, scaleMax, respondedAt: new Date() },
      });
  } else {
    const updated = await db
      .update(studyResponse)
      .set({ value, scaleMax, respondedAt: new Date() })
      .where(
        and(
          eq(studyResponse.userId, userId),
          isNull(studyResponse.captureSessionId),
          eq(studyResponse.phase, phase),
          eq(studyResponse.item, item),
        ),
      )
      .returning({ id: studyResponse.id });
    if (updated.length === 0) await db.insert(studyResponse).values(values);
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
