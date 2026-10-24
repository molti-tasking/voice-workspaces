"use client";

import type { ComponentProps } from "react";
import type { ConversationDisplay as Display } from "@voicemural/shared";
// A type only: the package index pulls in server code.
import type { MirrorBullets } from "@voicemural/talkback";
import type { ConversationStore } from "@/lib/talkback/conversation";
import type { SparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { ConversationFlow, StatusLine, type FlowStatus } from "./conversation-flow";
import { ConversationMirror } from "./conversation-mirror";
import { ConversationTranscript } from "./conversation-transcript";

/**
 * One drive's conversation, shown one of four ways (`ConversationDisplay` in
 * @voicemural/shared): the plain transcript, the column in order, or the
 * mirror as a track or as bubbles — three of which the display study
 * compares.
 * Used by the recorder (its own choice, or the one a drive forces) and the
 * simulated conversation, so both draw the same thing for the same display.
 *
 * Every display ends in the same status line. Which of them has sparks is
 * the caller's to say: `sparks` is null where the drive has none.
 */

/** What only the column in order takes. */
type FlowOnly = Pick<ComponentProps<typeof ConversationFlow>, "drafts" | "keepable" | "onRename">;

export function ConversationDisplay({
  display,
  store,
  status,
  sparks,
  live,
  captureSessionId,
  canPull,
  onPull,
  fixedPoints,
  placeholder,
  flow,
  className = "",
}: {
  display: Display;
  store: ConversationStore;
  /** The line under the conversation; null when talk-back is not running. */
  status: FlowStatus | null;
  /** The drive's sparks, or null where it has none. */
  sparks: SparkLedger | null;
  live: boolean;
  /** The drive the mirror's points are written for. */
  captureSessionId: string | null;
  /** A pulled spark can reach the agent now. */
  canPull: boolean;
  onPull: (spark: SparkRequest) => Promise<PokeResult | null>;
  /** The mirror's points, given rather than written (the simulated conversation). */
  fixedPoints?: ReadonlyMap<string, MirrorBullets>;
  /** Shown until anything has been said. */
  placeholder?: string;
  flow: FlowOnly;
  className?: string;
}) {
  if (display === "conversation") {
    return (
      <ConversationFlow
        store={store}
        live={live}
        status={status}
        sparks={sparks}
        placeholder={placeholder}
        className={className}
        {...flow}
      />
    );
  }
  return (
    <div className={`flex flex-col ${className}`}>
      {display === "transcript" ? (
        <ConversationTranscript store={store} placeholder={placeholder} className="min-h-0 flex-1" />
      ) : (
        <ConversationMirror
          store={store}
          sparks={sparks}
          layout={display}
          captureSessionId={captureSessionId}
          fixedPoints={fixedPoints}
          live={live}
          canPull={canPull}
          onPull={onPull}
          className="min-h-0 flex-1"
        />
      )}
      {status && <StatusLine status={status} />}
    </div>
  );
}
