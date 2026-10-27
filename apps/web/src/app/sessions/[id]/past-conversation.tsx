"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { DraftCue } from "@/lib/display/use-cues";
import { EMPTY_CONVERSATION, type ConversationStore } from "@/lib/talkback/conversation";
import { replayConversation, type DriveRecord } from "@/lib/talkback/replay";
import { ViewSwitch, useRecordView } from "../../record/view-switch";
import { ConversationView } from "../../record/views/conversation-view";

/**
 * A past conversation, shown exactly as it was live: the same views, the same
 * switch, with the time bar to go back to any point of it — and Continue,
 * which picks it up where it was left, on the recorder.
 *
 * The conversation is rebuilt from what was stored (`replay.ts`) into a store
 * that never changes, so the views read it as they read a live one.
 */
export function PastConversation({
  drives,
  lastDriveId,
  drafts,
}: {
  /** The conversation's drives, first first. */
  drives: DriveRecord[];
  /** Its latest drive: the one Continue picks up, and the one the digest is written for. */
  lastDriveId: string;
  drafts: DraftCue[];
}) {
  const view = useRecordView();
  const [store] = useState(() => frozenStore(drives));

  return (
    <div className="flex flex-col gap-3">
      {/* First, above the fold on a phone: picking it up is why most come back. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/record?continue=${lastDriveId}`}
          className="flex min-h-11 items-center gap-2 rounded-full bg-fg px-5 text-base font-semibold text-canvas hover:bg-fg/90"
        >
          <Play size={16} aria-hidden fill="currentColor" />
          Continue
        </Link>
        <Link
          href={`/sessions/${lastDriveId}/details`}
          className="min-h-11 content-center px-2 text-sm text-fg/60 underline-offset-2 hover:text-fg hover:underline"
        >
          Recording details
        </Link>
      </div>
      <ViewSwitch view={view} />
      <ConversationView
        view={view}
        store={store}
        live={false}
        captureSessionId={lastDriveId}
        drafts={drafts}
        placeholder="Nothing was transcribed in this conversation yet."
        className="h-[62dvh] min-h-96"
      />
    </div>
  );
}

/** A store holding one conversation that never changes. */
function frozenStore(drives: DriveRecord[]): ConversationStore {
  const state = drives.length > 0 ? replayConversation(drives) : EMPTY_CONVERSATION;
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    // A record: the page offers nothing that would change it.
    dispatch: () => undefined,
  };
}
