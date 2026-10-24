"use client";

import type { TopicEntry } from "./topics";

/**
 * Now: one line, large, saying where the conversation is — rewritten as it
 * moves (the digest's `now`) — under the name of the topic it is on. The
 * least a screen can show and still answer "where were we?" in one glance.
 * A tap zooms into that topic.
 */
export function NowView({
  now,
  current,
  pending,
  onZoom,
}: {
  now: string | null;
  current: TopicEntry | null;
  /** The line for this point is being written. */
  pending: boolean;
  onZoom: (key: string) => void;
}) {
  if (!current && !now) {
    return <p className="m-auto max-w-xs text-center text-sm text-fg/55">Where the conversation is shows here as you talk.</p>;
  }
  const body = (
    <>
      {current && <span className="text-sm font-medium tracking-wide text-fg/55 uppercase">{current.title}</span>}
      <span className={["text-3xl leading-tight font-semibold text-balance", now ? "text-fg" : "text-fg/40"].join(" ")}>
        {now ?? (pending ? "…" : current?.title)}
      </span>
    </>
  );
  return (
    <div className="ph-no-capture flex min-h-0 flex-1 items-center justify-center px-2">
      {current ? (
        <button
          type="button"
          onClick={() => onZoom(current.key)}
          className="flex max-w-xl cursor-pointer flex-col items-center gap-3 rounded-3xl px-4 py-6 text-center hover:bg-fg/[0.03]"
        >
          {body}
        </button>
      ) : (
        <p className="flex max-w-xl flex-col items-center gap-3 px-4 py-6 text-center">{body}</p>
      )}
    </div>
  );
}
