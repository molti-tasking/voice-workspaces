import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, getDb } from "@voicemural/db";
import { agentTurn, audioChunk, captureSession, utterance } from "@voicemural/db/schema";
import { findCoverageGaps, formatOffset } from "@voicemural/shared";
import { currentUser } from "@/lib/session";
import { AutoRefresh } from "./auto-refresh";
import { Transcript, type AgentTurnRow, type TranscriptRow } from "./transcript";
import { ViewEvent } from "@/lib/analytics/view-event";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Session",
  robots: { index: false, follow: false },
};

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) notFound();

  const { id } = await params;
  const db = getDb();

  const [meta] = await db
    .select()
    .from(captureSession)
    .where(and(eq(captureSession.id, id), eq(captureSession.userId, user.id)))
    .limit(1);

  if (!meta) notFound();

  const chunks = await db
    .select({
      id: audioChunk.id,
      seq: audioChunk.seq,
      startOffsetMs: audioChunk.startOffsetMs,
      durationMs: audioChunk.durationMs,
      status: audioChunk.status,
      failureReason: audioChunk.failureReason,
    })
    .from(audioChunk)
    .where(eq(audioChunk.captureSessionId, id))
    .orderBy(asc(audioChunk.seq));

  const rows: TranscriptRow[] = await db
    .select({
      id: utterance.id,
      startOffsetMs: utterance.startOffsetMs,
      endOffsetMs: utterance.endOffsetMs,
      text: utterance.text,
      kind: utterance.kind,
      kindOverride: utterance.kindOverride,
    })
    .from(utterance)
    .where(eq(utterance.captureSessionId, id))
    .orderBy(asc(utterance.startOffsetMs));

  // The system's own turns, on the same session clock, so the two read as one
  // dialogue. A separate table by design — see the comment on `agentTurn`.
  const turns: AgentTurnRow[] = await db
    .select({
      id: agentTurn.id,
      seq: agentTurn.seq,
      startOffsetMs: agentTurn.startOffsetMs,
      endOffsetMs: agentTurn.endOffsetMs,
      text: agentTurn.text,
      generatedText: agentTurn.generatedText,
      bargedIn: agentTurn.bargedIn,
      truncatedAtMs: agentTurn.truncatedAtMs,
      respondingToText: agentTurn.respondingToText,
      resolvedModel: agentTurn.resolvedModel,
      asrMs: agentTurn.asrMs,
      ttftMs: agentTurn.ttftMs,
      speakTtfbMs: agentTurn.speakTtfbMs,
      totalLatencyMs: agentTurn.totalLatencyMs,
      error: agentTurn.error,
    })
    .from(agentTurn)
    .where(eq(agentTurn.captureSessionId, id))
    .orderBy(asc(agentTurn.startOffsetMs));

  // Surface lost audio explicitly. A session with holes must never be mistaken
  // for a complete one when the corpus is analysed.
  const gaps = findCoverageGaps(chunks);
  const recordedMs = chunks.reduce((acc, c) => acc + c.durationMs, 0);
  const failed = chunks.filter((c) => c.status === "failed");
  const untranscribed = chunks.filter(
    (c) => c.status === "stored" || c.status === "transcribing",
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <AutoRefresh pending={untranscribed.length} />
      <ViewEvent
        event="transcript_viewed"
        properties={{
          capture_session_id: id,
          utterance_count: rows.length,
          // Whether the participant is looking at a clean transcript or a
          // damaged one changes how to read anything else they do next.
          has_gaps: gaps.length > 0,
          has_failed_chunks: failed.length > 0,
        }}
      />

      <Link href="/" className="text-sm text-white/40 underline-offset-4 hover:underline">
        ← Sessions
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold">
          {meta.startedAt.toLocaleString(undefined, {
            dateStyle: "full",
            timeStyle: "short",
          })}
        </h1>
        <p className="mt-1 text-sm text-white/40">
          {formatOffset(recordedMs)} recorded · {chunks.length} chunks ·{" "}
          {rows.length} utterances
          {turns.length > 0 && ` · ${turns.length} agent turn${turns.length === 1 ? "" : "s"}`}
          {meta.endedAt === null && " · still open"}
        </p>
      </header>

      <div className="mb-6 space-y-3 text-sm">
        {gaps.length > 0 && (
          <Banner tone="warn" title={`${gaps.length} gap${gaps.length === 1 ? "" : "s"} in audio`}>
            Missing:{" "}
            {gaps
              .map((g) => `${formatOffset(g.fromMs)}–${formatOffset(g.toMs)}`)
              .join(", ")}
            . Most likely a dead zone that outlasted the upload queue, or a suspended
            tab.
          </Banner>
        )}

        {untranscribed.length > 0 && (
          <Banner tone="info" title={`${untranscribed.length} chunk(s) awaiting transcription`}>
            The worker picks these up automatically. If they sit here, check that
            <code className="mx-1 rounded bg-white/10 px-1">apps/worker</code>is running.
          </Banner>
        )}

        {failed.length > 0 && (
          <Banner tone="error" title={`${failed.length} chunk(s) failed to transcribe`}>
            {failed[0]?.failureReason ?? "Unknown error"}. The audio is still stored, so
            these can be retried.
          </Banner>
        )}
      </div>

      <Transcript rows={rows} turns={turns} />
    </div>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "warn" | "error" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    error: "border-red-500/30 bg-red-500/10 text-red-200",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-100",
  } as const;

  return (
    <div className={`rounded-lg border p-3 ${styles[tone]}`}>
      <p className="mb-1 font-medium">{title}</p>
      <div className="text-white/60">{children}</div>
    </div>
  );
}
