import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb, sparkKindEnum } from "@voicemural/db";
import { scheduleRecallProbes } from "@voicemural/db/recall";
import { saveSubjectSignals } from "@voicemural/db/subjects";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep what the recorder worked out about each subject of a drive: whose
 * words, how sure they sounded, settled or open, and the sparks it showed and
 * the ones pulled (apps/web/src/lib/talkback/signals.ts).
 *
 * Posted at Stop (`final`) and as a best effort when the page is hidden mid-
 * drive. Counts, a boolean, a number and enums only — no title, no words —
 * keyed by the subject's ordinal; see `subject_signal`.
 *
 * Session-authorised, with ownership of the drive re-resolved as
 * `/api/study/response` does it, and NOT refused once the drive has ended:
 * Stop is the moment it is sent. The final post also schedules the drive's
 * recall probe, days later.
 */
const SparkKind = z.enum(sparkKindEnum.enumValues);
const count = z.number().int().min(0).max(1_000_000);
const Body = z.object({
  captureSessionId: z.uuid(),
  final: z.boolean(),
  signalsVersion: z.string().min(1).max(32).optional(),
  subjects: z
    .array(
      z.object({
        ordinal: z.number().int().min(1).max(10_000),
        userWords: count,
        agentWords: count,
        pauses: count,
        pausesBefore: count,
        fillers: count,
        selfRepairs: count,
        hedges: count,
        settled: z.boolean().nullable(),
        fade: z.number().min(0).max(1),
        sparksShown: z.array(SparkKind).max(4),
        sparksPulled: z.array(SparkKind).max(4),
      }),
    )
    .max(200),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { captureSessionId, final, signalsVersion, subjects } = parsed.data;

  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (rows[0]?.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await saveSubjectSignals(captureSessionId, subjects, { final, signalsVersion });
  if (final) await scheduleRecallProbes(captureSessionId);
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
