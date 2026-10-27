import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, getDb, inArray } from "@voicemural/db";
import { loadConversation } from "@voicemural/db/conversation";
import { loadSessionDraftHistory } from "@voicemural/db/drafts";
import { audioChunk } from "@voicemural/db/schema";
import { findCoverageGaps } from "@voicemural/shared";
import { AppDock } from "@/components/app-dock";
import { BackLink } from "@/components/back-link";
import { ViewEvent } from "@/lib/analytics/view-event";
import { currentUser } from "@/lib/session";
import { draftMajor } from "@/lib/talkback/conversation";
import type { DriveRecord } from "@/lib/talkback/replay";
import { AutoRefresh } from "./auto-refresh";
import { CopyDebug } from "./copy-debug";
import { PastConversation } from "./past-conversation";
import { SessionDrafts } from "./session-drafts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false, follow: false },
};

/**
 * A past conversation, shown as it was live: the same views and switch as the
 * recorder, the time bar to go back to any point, and Continue to pick it up
 * where it was left. A conversation that was continued is one conversation
 * here, whichever of its drives the link named.
 *
 * How it was recorded — the ledger line by line, timings, gaps, failures — is
 * on `/sessions/[id]/details`.
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) notFound();
  const { id } = await params;

  const drives = await loadConversation(user.id, id);
  if (!drives || drives.length === 0) notFound();
  const ids = drives.map((d) => d.id);
  const first = drives[0]!;
  const last = drives.at(-1)!;

  const [chunks, histories] = await Promise.all([
    getDb()
      .select({
        captureSessionId: audioChunk.captureSessionId,
        seq: audioChunk.seq,
        startOffsetMs: audioChunk.startOffsetMs,
        durationMs: audioChunk.durationMs,
        status: audioChunk.status,
      })
      .from(audioChunk)
      .where(inArray(audioChunk.captureSessionId, ids))
      .orderBy(asc(audioChunk.seq)),
    Promise.all(ids.map((driveId) => loadSessionDraftHistory(driveId))),
  ]);
  const untranscribed = chunks.filter((c) => c.status === "stored" || c.status === "transcribing");
  // Whether what is shown is complete, for reading what they do next.
  const hasGaps = ids.some((driveId) => findCoverageGaps(chunks.filter((c) => c.captureSessionId === driveId)).length > 0);

  // Times formatted HERE, on the server: a client component would render the
  // server's locale first and the browser's on hydration, and React tears the
  // tree down over the mismatch.
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const drafts = histories.flat().map((draft) => ({
    ...draft,
    current: { ...draft.current, at: time(draft.current.createdAt) },
    earlier: draft.earlier.map((v) => ({ ...v, at: time(v.createdAt) })),
  }));

  const records: DriveRecord[] = drives.map((drive, i) => ({
    lines: drive.lines.map(({ who, startMs, endMs, text }) => ({ who, startMs, endMs, text })),
    visits: drive.visits.map(({ ordinal, title, startMs }) => ({ ordinal, title, startMs })),
    subjects: drive.subjects,
    drafts: histories[i]!.map((d) => ({ draftId: d.id, major: draftMajor(d.current.version), startMs: d.startOffsetMs })),
  }));

  const title = last.title ?? first.title;
  const when = first.startedAt.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl vm-page-top px-4 pb-40 sm:px-6">
      <AutoRefresh pending={untranscribed.length} />
      <ViewEvent
        event="transcript_viewed"
        properties={{
          capture_session_id: id,
          utterance_count: records.reduce((n, r) => n + r.lines.filter((l) => l.who === "user").length, 0),
          has_gaps: hasGaps,
          has_failed_chunks: chunks.some((c) => c.status === "failed"),
        }}
      />
      <BackLink fallback={{ href: "/conversations", name: "Conversations" }} />

      <header className="mt-4 mb-5">
        <h1 className="text-2xl font-semibold">{title ?? when}</h1>
        <p className="mt-1 text-sm text-fg/60">
          {title ? when : null}
          {drives.length > 1 && `${title ? " · " : ""}continued ${drives.length - 1}×`}
          {last.endedAt === null && " · still open"}
          {untranscribed.length > 0 && " · still transcribing"}
        </p>
        <div className="mt-2">
          <CopyDebug captureSessionId={last.id} />
        </div>
      </header>

      <PastConversation
        drives={records}
        lastDriveId={last.id}
        drafts={drafts.map((d) => ({
          id: d.id,
          title: d.current.title,
          text: d.current.text,
          version: d.current.version,
          at: d.current.at,
        }))}
      />

      {/* Where they are changed: the chat only shows the latest. */}
      <div className="mt-8">
        <SessionDrafts drafts={drafts} />
      </div>

      <AppDock />
    </div>
  );
}
