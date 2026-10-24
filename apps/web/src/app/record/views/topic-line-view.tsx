"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TopicEntry } from "./topics";

/**
 * The topic line: each topic once, one under the other in the order they came
 * up, on a single thin line. The one being talked about is larger; one they
 * landed on has a check. Nothing else at a glance — no sides, no sentences —
 * and a tap zooms into a topic: its points, the assistant's ideas, its lines.
 *
 * WITH UPTAKE, each topic also carries one small circle per idea the
 * assistant brought to it: filled once they have taken it up in their own
 * words (chosen it, built on it, decided it), hollow until then. What is
 * still only the assistant's, at a glance.
 *
 * NOTHING MOVES. A topic keeps its place once it has one, and changes happen
 * at once, without animation: motion at the edge of vision pulls the eye,
 * which is what a glance must not cost.
 */
export function TopicLineView({
  topics,
  uptake,
  onZoom,
}: {
  topics: TopicEntry[];
  /** Show the assistant's ideas on each topic, taken up or not. */
  uptake: boolean;
  onZoom: (key: string) => void;
}) {
  const current = useRef<HTMLLIElement>(null);
  const currentKey = topics.find((t) => t.current)?.key ?? null;
  // Keep the topic being talked about in view: a new one is at the bottom, a
  // return can be far up.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [currentKey, topics.length]);

  if (topics.length === 0) {
    return <p className="m-auto max-w-xs text-center text-sm text-fg/55">Topics appear here as you talk.</p>;
  }

  return (
    // Newest at the bottom, as in the chat: the list sits at the end of the space.
    <div className="ph-no-capture flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <ol className="relative mt-auto py-3">
        <span aria-hidden className="absolute inset-y-6 left-[15px] w-px bg-line" />
        {topics.map((topic) => {
          const taken = topic.ideas.filter((i) => i.takenUp).length;
          return (
            <li key={topic.key} ref={topic.current ? current : undefined} className="relative">
              <button
                type="button"
                onClick={() => onZoom(topic.key)}
                aria-current={topic.current ? "step" : undefined}
                aria-label={[
                  topic.title,
                  topic.current ? "being talked about" : null,
                  topic.settled ? "settled" : null,
                  uptake && topic.ideas.length > 0
                    ? `${taken} of the assistant's ${topic.ideas.length} ideas taken up`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl py-1.5 pr-2 text-left hover:bg-fg/[0.04]"
              >
                <span aria-hidden className="grid w-8 shrink-0 place-items-center">
                  {topic.settled ? (
                    <span className="grid size-5 place-items-center rounded-full bg-canvas text-fg/70 ring-1 ring-fg/30">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className={[
                        "rounded-full ring-4 ring-canvas",
                        topic.current ? "size-3.5 bg-fg" : "size-2.5 bg-fg/35",
                      ].join(" ")}
                    />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={[
                      "line-clamp-2 leading-snug break-words",
                      topic.current ? "text-xl font-semibold text-fg" : "text-base text-fg/65",
                    ].join(" ")}
                  >
                    {topic.title}
                  </span>
                  {uptake && topic.ideas.length > 0 && <IdeaDots ideas={topic.ideas} />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One circle per idea of the assistant's: filled once taken up, hollow until then. */
export function IdeaDots({ ideas }: { ideas: readonly { takenUp: boolean }[] }) {
  return (
    <span aria-hidden className="flex flex-wrap gap-1.5">
      {ideas.map((idea, i) => (
        <span
          key={i}
          className={[
            "size-2.5 rounded-full",
            idea.takenUp ? "bg-sky-600 dark:bg-sky-400" : "ring-[1.5px] ring-sky-600/70 ring-inset dark:ring-sky-400/70",
          ].join(" ")}
        />
      ))}
    </span>
  );
}
