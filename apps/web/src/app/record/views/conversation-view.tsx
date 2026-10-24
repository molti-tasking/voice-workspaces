"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { ConversationDisplay } from "@voicemural/shared";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { ConversationDigest } from "@voicemural/talkback/digest";
import type { DraftCue } from "@/lib/display/use-cues";
import { EMPTY_CONVERSATION, type Conversation, type ConversationStore } from "@/lib/talkback/conversation";
import { atCursor, cursorLabel, turnsInOrder } from "@/lib/talkback/cursor";
import { useDigest } from "@/lib/talkback/use-digest";
import { ChatView } from "./chat-view";
import { NowView } from "./now-view";
import { OpenView } from "./open-view";
import { StatusLine, type FlowStatus } from "./status-line";
import { TimeBar } from "./time-bar";
import { TopicLineView } from "./topic-line-view";
import { TopicSheet } from "./topic-sheet";
import { questionEntries, topicEntries } from "./topics";

/**
 * One conversation, shown one of the five ways (`ConversationDisplay` in
 * @voicemural/shared) — the same component live on the recorder, in the
 * display study, in the simulated conversation, and for a past conversation
 * on its page. Where the conversation comes from is the store's business:
 * the container's messages, a script, or storage replayed (`replay.ts`).
 *
 * WHAT EVERY VIEW SHARES, it gets here, so a view is only how it draws:
 * - the conversation at the cursor (`atCursor`): the time bar takes every view
 *   back in time the same way;
 * - the digest for that point (`useDigest`), asked for only by views that
 *   read it — the chat never spends a model call;
 * - zooming into a topic (`TopicSheet`), with rename and keep;
 * - the status line, the same under every view.
 */
export function ConversationView({
  view,
  store,
  live,
  status = null,
  captureSessionId,
  fixedDigest,
  drafts = NO_DRAFTS,
  placeholder,
  onRename,
  keepable = false,
  timeBar = true,
  className = "",
}: {
  view: ConversationDisplay;
  store: ConversationStore;
  /** The drive is running: the chat follows the newest line. */
  live: boolean;
  /** The line under the conversation; null when nothing is talking. */
  status?: FlowStatus | null;
  /** The drive the digest is written for; null asks for none. */
  captureSessionId: string | null;
  /** A digest worked out locally, for a conversation with no AI behind it. */
  fixedDigest?: (conversation: Conversation) => ConversationDigest;
  drafts?: readonly DraftCue[];
  /** Shown until anything has been said. */
  placeholder?: string;
  onRename?: (ordinal: number, title: string) => boolean;
  /** A zoomed topic offers Keep (`sparkSelection: chosen`). */
  keepable?: boolean;
  /** Offer going back in time. */
  timeBar?: boolean;
  className?: string;
}) {
  const full = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const [cursor, setCursor] = useState<number | null>(null);
  const shown = useMemo(() => atCursor(full, cursor), [full, cursor]);
  const turns = useMemo(() => turnsInOrder(full), [full]);

  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const reads = view !== "chat" || zoomKey !== null;
  const { digest, pending } = useDigest(shown, {
    captureSessionId: reads ? captureSessionId : null,
    ...(fixedDigest ? { fixed: fixedDigest } : {}),
  });

  const topics = useMemo(() => topicEntries(shown, digest), [shown, digest]);
  const zoomed = zoomKey ? (topics.find((t) => t.key === zoomKey) ?? null) : null;
  const titleOf = (ordinal: number) => full.sections.find((s) => s.ordinal === ordinal)?.title ?? null;
  const zoomOrdinal = (ordinal: number) => {
    const key = shown.sections.find((s) => s.ordinal === ordinal)?.key;
    if (key) setZoomKey(key);
  };

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`}>
      {view === "chat" ? (
        <ChatView
          conversation={shown}
          follow={live && cursor === null}
          drafts={drafts}
          placeholder={placeholder}
          titleOf={titleOf}
        />
      ) : view === "topics" || view === "uptake" ? (
        <TopicLineView topics={topics} uptake={view === "uptake"} onZoom={setZoomKey} />
      ) : view === "now" ? (
        <NowView now={digest.now} current={topics.find((t) => t.current) ?? null} pending={pending} onZoom={setZoomKey} />
      ) : (
        <OpenView questions={questionEntries(shown, digest)} pending={pending} onZoom={zoomOrdinal} />
      )}

      {zoomed && (
        <TopicSheet
          topic={zoomed}
          pending={pending}
          onClose={() => setZoomKey(null)}
          {...(onRename ? { onRename } : {})}
          {...(keepable ? { onKeep: (ordinal, kept) => store.dispatch({ type: "keep", ordinal, kept, via: "tap" }) } : {})}
        />
      )}

      {timeBar && turns.length > 1 && (
        <TimeBar
          turns={turns}
          cursor={cursor}
          label={cursor === null ? null : cursorLabel(full, cursor)}
          onCursor={setCursor}
        />
      )}
      {status && <StatusLine status={status} />}
    </div>
  );
}

const NO_DRAFTS: readonly DraftCue[] = [];
