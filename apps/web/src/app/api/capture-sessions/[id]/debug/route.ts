import { NextResponse } from "next/server";
import { asc, eq, getDb, inArray } from "@voicemural/db";
import { conversationChain } from "@voicemural/db/conversation";
import {
  agentDecision,
  agentTurn,
  captureSession,
  driveSubject,
  driveSubjectSegment,
  floorEvent,
  studyBlock,
  studyMoment,
  subjectSignal,
  utterance,
} from "@voicemural/db/schema";
import { currentUserId } from "@/lib/session";
import { renderDebugTranscript, type DebugDrive } from "@/lib/talkback/debug-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One conversation as plain text, for debugging (`debug-transcript.ts`): the
 * whole chain it belongs to, each drive's settings, topics and a timeline of
 * both transcripts, the agent's turns and what interrupted them. Theirs only.
 *
 * Opened as a page it reads as text; the conversation's page copies it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;

  const ids = await conversationChain(userId, id).catch(() => []);
  if (ids.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const db = getDb();
  const [sessions, utterances, turns, decisions, floors, subjects, blocks, moments] = await Promise.all([
    db.select().from(captureSession).where(inArray(captureSession.id, ids)),
    db
      .select({ sessionId: utterance.captureSessionId, startMs: utterance.startOffsetMs, text: utterance.text })
      .from(utterance)
      .where(inArray(utterance.captureSessionId, ids))
      .orderBy(asc(utterance.startOffsetMs)),
    db.select().from(agentTurn).where(inArray(agentTurn.captureSessionId, ids)).orderBy(asc(agentTurn.seq)),
    db.select().from(agentDecision).where(inArray(agentDecision.captureSessionId, ids)).orderBy(asc(agentDecision.seq)),
    db.select().from(floorEvent).where(inArray(floorEvent.captureSessionId, ids)).orderBy(asc(floorEvent.seq)),
    db
      .select({
        sessionId: driveSubject.captureSessionId,
        ordinal: driveSubject.ordinal,
        title: driveSubject.title,
        startMs: driveSubjectSegment.startOffsetMs,
        endMs: driveSubjectSegment.endOffsetMs,
        settled: subjectSignal.settled,
        kept: subjectSignal.kept,
      })
      .from(driveSubject)
      .leftJoin(driveSubjectSegment, eq(driveSubjectSegment.driveSubjectId, driveSubject.id))
      .leftJoin(subjectSignal, eq(subjectSignal.driveSubjectId, driveSubject.id))
      .where(inArray(driveSubject.captureSessionId, ids))
      .orderBy(asc(driveSubject.ordinal), asc(driveSubjectSegment.startOffsetMs)),
    db.select().from(studyBlock).where(inArray(studyBlock.captureSessionId, ids)),
    db.select().from(studyMoment).where(inArray(studyMoment.captureSessionId, ids)).orderBy(asc(studyMoment.shownOffsetMs)),
  ]);

  const drives: DebugDrive[] = ids.flatMap((driveId) => {
    const s = sessions.find((row) => row.id === driveId);
    if (!s) return [];
    const block = blocks.find((b) => b.captureSessionId === driveId);
    const own = decisions.filter((d) => d.captureSessionId === driveId);
    const bySubject = new Map<number, DebugDrive["subjects"][number]>();
    for (const row of subjects.filter((r) => r.sessionId === driveId)) {
      const subject = bySubject.get(row.ordinal) ?? {
        ordinal: row.ordinal,
        title: row.title,
        visits: [],
        settled: row.settled ?? null,
        kept: row.kept ?? false,
      };
      if (row.startMs !== null) subject.visits.push({ startMs: row.startMs, endMs: row.endMs });
      bySubject.set(row.ordinal, subject);
    }
    return [
      {
        id: driveId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        title: s.title,
        sttLanguage: s.sttLanguage,
        voiceId: s.voiceId,
        condition: (s.studyCondition as Record<string, unknown> | null) ?? null,
        block: block ? { display: block.display, task: block.task } : null,
        utterances: utterances.filter((u) => u.sessionId === driveId).map(({ startMs, text }) => ({ startMs, text })),
        turns: turns
          .filter((t) => t.captureSessionId === driveId)
          .map((t) => ({
            seq: t.seq,
            startMs: t.startOffsetMs,
            endMs: t.endOffsetMs,
            kind: t.kind,
            text: t.text,
            generatedText: t.generatedText,
            respondingToText: t.respondingToText,
            bargedIn: t.bargedIn,
            totalLatencyMs: t.totalLatencyMs,
            configVersion: t.configVersion,
            resolvedModel: t.resolvedModel,
            trigger: own.find((d) => d.agentTurnId === t.id)?.trigger ?? null,
          })),
        silentAttempts: own
          .filter((d) => d.agentTurnId === null && d.outcome === "interrupted")
          .map((d) => ({ offsetMs: d.offsetMs, trigger: d.trigger })),
        floor: floors
          .filter((f) => f.captureSessionId === driveId)
          .map((f) => ({ offsetMs: f.offsetMs, kind: f.kind, atConnect: f.atConnect })),
        subjects: [...bySubject.values()],
        moments: moments
          .filter((m) => m.captureSessionId === driveId)
          .map((m) => ({ item: m.item, shownMs: m.shownOffsetMs, answeredMs: m.answeredOffsetMs })),
      },
    ];
  });

  return new Response(renderDebugTranscript(drives), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
