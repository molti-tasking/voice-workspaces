"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { ConversationDisplay } from "@voicemural/shared";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { TopicComprehension } from "@voicemural/talkback/comprehension";
import type { ConversationDigest } from "@voicemural/talkback/digest";
import type { DraftCue } from "@/lib/display/use-cues";
import { needsRethink } from "@/lib/talkback/comprehension-monitor";
import {
  EMPTY_CONVERSATION,
  type Conversation,
  type ConversationStore,
} from "@/lib/talkback/conversation";
import { useComprehension } from "@/lib/talkback/use-comprehension";
import { useDigest } from "@/lib/talkback/use-digest";
import { useTurnGists } from "@/lib/talkback/use-turn-gists";
import { ChatView } from "./chat-view";
import { NowView } from "./now-view";
import { OpenView } from "./open-view";
import { RecentView } from "./recent-view";
import { StackView } from "./stack-view";
import { StatusLine, type FlowStatus } from "./status-line";
import { TopicLineView } from "./topic-line-view";
import { TopicSheet, type AskTopic } from "./topic-sheet";
import { questionEntries, topicEntries } from "./topics";

/**
 * One conversation, shown one of the seven ways (`ConversationDisplay` in
 * @voicemural/shared) — the same component live on the recorder, in the
 * display study, in the simulated conversation, and for a past conversation
 * on its page. Where the conversation comes from is the store's business:
 * the container's messages, a script, or storage replayed (`replay.ts`).
 *
 * WHAT EVERY VIEW SHARES, it gets here, so a view is only how it draws:
 * - the digest (`useDigest`), asked for only by views that read it — the
 *   chat never spends a model call;
 * - zooming into a topic (`TopicSheet`), with rename and keep;
 * - the status line, the same under every view;
 * - the comprehension monitor (DRAFT, `use-comprehension.ts`), when `monitor`
 *   is on: in the background while live, for the zoomed topic otherwise.
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
  monitor = false,
  fixedComprehension,
  onAsk,
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
  /** Run the comprehension monitor (draft). */
  monitor?: boolean;
  /** What the monitor would find, worked out locally, for a conversation with no AI behind it. */
  fixedComprehension?: (
    conversation: Conversation,
  ) => ReadonlyMap<number, TopicComprehension>;
  /** Live only: hand a question about a topic to the agent. */
  onAsk?: AskTopic;
  className?: string;
}) {
  const conversation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_CONVERSATION,
  );

  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const reads = view !== "chat" || zoomKey !== null;
  const { digest, pending } = useDigest(conversation, {
    captureSessionId: reads ? captureSessionId : null,
    ...(fixedDigest ? { fixed: fixedDigest } : {}),
  });

  // The turn just answered, as a gist while the answer is being said (Stack's line, Recent's words).
  const turnGists = useTurnGists(
    conversation,
    live && (view === "stack" || view === "recent") ? captureSessionId : null,
  );
  const gists = useMemo(
    () =>
      turnGists.length === 0
        ? digest.gists
        : [...(digest.gists ?? []), ...turnGists],
    [digest.gists, turnGists],
  );
  const topics = useMemo(() => topicEntries(conversation, digest), [conversation, digest]);
  const zoomed = zoomKey
    ? (topics.find((t) => t.key === zoomKey) ?? null)
    : null;
  const monitored = useComprehension(conversation, captureSessionId, {
    live,
    focus: zoomed?.ordinal ?? null,
    enabled: monitor && !fixedComprehension,
  });
  const comprehension = useMemo(
    () => (fixedComprehension ? fixedComprehension(conversation) : monitored),
    [fixedComprehension, conversation, monitored],
  );
  const rethink = useMemo(
    () =>
      new Set(
        conversation.sections.flatMap((s) =>
          s.ordinal !== undefined && needsRethink(comprehension.get(s.ordinal))
            ? [s.key]
            : [],
        ),
      ),
    [conversation.sections, comprehension],
  );
  const titleOf = (ordinal: number) =>
    conversation.sections.find((s) => s.ordinal === ordinal)?.title ?? null;
  const zoomOrdinal = (ordinal: number) => {
    const key = conversation.sections.find((s) => s.ordinal === ordinal)?.key;
    if (key) setZoomKey(key);
  };

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`}>
      {view === "chat" ? (
        <ChatView
          conversation={conversation}
          follow={live}
          drafts={drafts}
          placeholder={placeholder}
          titleOf={titleOf}
        />
      ) : view === "topics" || view === "uptake" ? (
        <TopicLineView
          topics={topics}
          uptake={view === "uptake"}
          onZoom={setZoomKey}
        />
      ) : view === "now" ? (
        <NowView
          now={digest.now}
          current={topics.find((t) => t.current) ?? null}
          onZoom={setZoomKey}
        />
      ) : view === "recent" ? (
        <RecentView
          conversation={conversation}
          gists={gists}
          topics={topics}
          onZoom={setZoomKey}
        />
      ) : view === "stack" ? (
        <StackView
          conversation={conversation}
          digest={gists === digest.gists ? digest : { ...digest, gists }}
          speaking={
            status?.speaking ? "agent" : status?.listening ? "user" : null
          }
          onZoom={setZoomKey}
          placeholder={placeholder}
          rethink={rethink}
        />
      ) : (
        <OpenView
          questions={questionEntries(conversation, digest)}
          onZoom={zoomOrdinal}
        />
      )}

      {zoomed && (
        <TopicSheet
          topic={zoomed}
          pending={pending}
          onClose={() => setZoomKey(null)}
          captureSessionId={captureSessionId}
          comprehension={
            zoomed.ordinal !== null
              ? comprehension.get(zoomed.ordinal)
              : undefined
          }
          onAsk={onAsk}
          {...(onRename ? { onRename } : {})}
          {...(keepable
            ? {
                onKeep: (ordinal, kept) =>
                  store.dispatch({ type: "keep", ordinal, kept, via: "tap" }),
              }
            : {})}
        />
      )}

      {status && <StatusLine status={status} />}
    </div>
  );
}

const NO_DRAFTS: readonly DraftCue[] = [];
