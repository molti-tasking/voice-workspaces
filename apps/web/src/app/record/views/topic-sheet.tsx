"use client";

import { BookmarkCheck, BookmarkPlus, Pencil, X } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_TITLE_CHARS, cleanSubjectTitle } from "@/lib/talkback/conversation";
import { useAgentName } from "../agent-name-context";
import { TurnLine } from "./chat-view";
import { IdeaDots } from "./topic-line-view";
import type { TopicEntry } from "./topics";

/**
 * Zoomed into one topic, from any view: the content first — what they said,
 * what the assistant said, the assistant's ideas and which they took up — and
 * the words themselves one tap further, for whoever wants them. Most of the
 * time a glance wants the content, not the transcript.
 *
 * Also where a topic is tidied: renamed (on screen, on the stored subject and
 * with the assistant) and kept, on a drive that lets them keep.
 *
 * A sheet over the view, not a page: closing it is where they were.
 */
export function TopicSheet({
  topic,
  pending,
  onClose,
  onRename,
  onKeep,
}: {
  topic: TopicEntry;
  /** Its points are being written. */
  pending: boolean;
  onClose: () => void;
  onRename?: (ordinal: number, title: string) => boolean;
  onKeep?: (ordinal: number, kept: boolean) => void;
}) {
  const agent = useAgentName();
  const [renaming, setRenaming] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const hasPoints = topic.you.length + topic.ai.length > 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-canvas/60" />
      <section
        role="dialog"
        aria-label={topic.title}
        className="ph-no-capture relative flex max-h-[85%] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-lg"
      >
        <header className="flex shrink-0 items-start gap-1 px-4 pt-3">
          {renaming && topic.ordinal !== null && onRename ? (
            <RenameField
              title={topic.title}
              onRename={(title) => {
                const ok = onRename(topic.ordinal!, title);
                if (ok) setRenaming(false);
                return ok;
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h2 className="min-w-0 flex-1 py-2 text-xl leading-snug font-semibold text-fg">{topic.title}</h2>
          )}
          {onRename && topic.ordinal !== null && !renaming && (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label={`Rename ${topic.title}`}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg/45 hover:bg-fg/[0.06] hover:text-fg/80"
            >
              <Pencil size={15} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg/60 hover:bg-fg/[0.06] hover:text-fg"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1 pb-4">
          {(topic.settled || (onKeep && topic.ordinal !== null)) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {topic.settled && <span className="rounded-full bg-fg/[0.07] px-2.5 py-1 text-fg/70">Settled</span>}
              {onKeep && topic.ordinal !== null && (
                <button
                  type="button"
                  aria-pressed={topic.kept}
                  onClick={() => onKeep(topic.ordinal!, !topic.kept)}
                  className={[
                    "flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium tracking-wide uppercase",
                    topic.kept ? "bg-fg/12 text-fg ring-1 ring-fg/25" : "text-fg/60 ring-1 ring-fg/15 hover:text-fg/80",
                  ].join(" ")}
                >
                  {topic.kept ? <BookmarkCheck size={14} aria-hidden /> : <BookmarkPlus size={14} aria-hidden />}
                  {topic.kept ? "Kept" : "Keep"}
                </button>
              )}
            </div>
          )}

          {hasPoints ? (
            <div className="space-y-3">
              <Points label="You" items={topic.you} />
              <Points label={agent.Name} items={topic.ai} />
            </div>
          ) : (
            <p className="text-sm text-fg/55">{pending ? "Summing up…" : "Nothing to sum up yet."}</p>
          )}

          {topic.ideas.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium tracking-wide text-fg/55 uppercase">{agent.Name}&rsquo;s ideas</h3>
              <ul className="space-y-1.5">
                {topic.ideas.map((idea, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-1">
                      <IdeaDots ideas={[idea]} />
                    </span>
                    <span className={idea.takenUp ? "text-fg" : "text-fg/70"}>{idea.text}</span>
                    <span className="ml-auto shrink-0 text-xs text-fg/50">{idea.takenUp ? "yours now" : "not yet"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <button
              type="button"
              aria-expanded={showLines}
              onClick={() => setShowLines((v) => !v)}
              className="min-h-11 cursor-pointer text-sm font-medium text-fg/70 underline-offset-2 hover:text-fg hover:underline"
            >
              {showLines ? "Hide the words" : `The words (${topic.turns.length} ${topic.turns.length === 1 ? "line" : "lines"})`}
            </button>
            {showLines && (
              <div className="mt-2 flex flex-col gap-3 select-text">
                {topic.turns.map((turn) => (
                  <TurnLine key={turn.id} turn={turn} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Points({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-fg/55 uppercase">{label}</h3>
      <ul className="mt-1 space-y-0.5 text-[15px] leading-snug text-fg">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Their own name for a topic. Enter or leaving the field keeps it; Escape
 * keeps the old one. A name another topic already has is refused, and said so.
 */
function RenameField({
  title,
  onRename,
  onCancel,
}: {
  title: string;
  onRename: (title: string) => boolean;
  onCancel: () => void;
}) {
  const [taken, setTaken] = useState(false);
  const done = useRef(false);
  const keep = (value: string, fromBlur: boolean) => {
    if (done.current) return;
    const next = cleanSubjectTitle(value);
    if (!next || next === title || onRename(next)) {
      done.current = true;
      if (!next || next === title) onCancel();
      return;
    }
    if (fromBlur) {
      done.current = true;
      onCancel();
    } else setTaken(true);
  };
  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-1 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        keep(new FormData(event.currentTarget).get("title")?.toString() ?? "", false);
      }}
    >
      <input
        name="title"
        autoFocus
        defaultValue={title}
        maxLength={MAX_TITLE_CHARS}
        aria-label="Topic name"
        enterKeyHint="done"
        autoComplete="off"
        onFocus={(event) => event.currentTarget.select()}
        onChange={() => setTaken(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        onBlur={(event) => keep(event.currentTarget.value, true)}
        className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-canvas px-3 text-base text-fg select-text"
      />
      {taken && <span className="text-xs text-amber-700 dark:text-amber-300/80">Another topic already has that name.</span>}
    </form>
  );
}
