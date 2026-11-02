"use client";

import { BookmarkCheck, BookmarkPlus, Check, Circle, CircleDot, HelpCircle, Pencil, Sparkle, X } from "lucide-react";
import { useRef, useState } from "react";
// The `/comprehension` subpath, not the package index: the index pulls in server code.
import type { TopicComprehension } from "@voicemural/talkback/comprehension";
import type { TopicCard } from "@voicemural/workspace";
import { CHECK_AS_SPARK, CHECK_LABELS } from "@/lib/talkback/comprehension-monitor";
import { MAX_TITLE_CHARS, cleanSubjectTitle } from "@/lib/talkback/conversation";
import type { SparkKind } from "@/lib/talkback/signals";
import { useTopicCards } from "@/lib/workspace/use-topic-cards";
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
 *
 * SINCE 2 NOV 2026 IT IS ALSO WHERE THE WORKSPACE IS. The workspace and the
 * board were their own screens; now a topic opens onto what the workspace
 * holds on it from every drive (`topic-cards.ts`): its tasks with their
 * state, its claims, open questions and facts. And, as a draft, onto what the
 * comprehension monitor found (`use-comprehension.ts`): which ideas are not
 * yet theirs, and one check to rethink them.
 *
 * ASKING, LIVE. During a drive a question card, the check and the topic
 * itself can be handed to the agent with one tap ("Ask me"): a poke that
 * carries the question, so the agent asks it back and does not answer it,
 * exactly as a pulled spark is asked.
 */
/** One tap that hands a question to the agent to ask; true when it was taken. */
export type AskTopic = (ordinal: number, question: string, kind: SparkKind) => Promise<boolean>;

export function TopicSheet({
  topic,
  pending,
  onClose,
  onRename,
  onKeep,
  captureSessionId = null,
  comprehension,
  onAsk,
}: {
  topic: TopicEntry;
  /** The drive it is on: narrows which workspace topic a loose name matches. */
  captureSessionId?: string | null;
  /** What the comprehension monitor found on it, if it has looked. */
  comprehension?: TopicComprehension | undefined;
  /** Live only: hand a question to the agent. */
  onAsk?: AskTopic | undefined;
  /** Its points are being written. */
  pending: boolean;
  onClose: () => void;
  onRename?: (ordinal: number, title: string) => boolean;
  onKeep?: (ordinal: number, kept: boolean) => void;
}) {
  const agent = useAgentName();
  const [renaming, setRenaming] = useState(false);
  const [showLines, setShowLines] = useState(false);
  // The assistant's side as its ideas, each marked taken up or not, when the
  // digest found any; its plain points otherwise.
  const theirs = topic.ideas.length > 0 ? [] : topic.ai;
  const hasContent = topic.you.length + theirs.length + topic.ideas.length > 0;
  const { cards, loading } = useTopicCards(topic.title, captureSessionId);
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const ask =
    onAsk && topic.ordinal !== null
      ? async (question: string, kind: SparkKind) => {
          if (await onAsk(topic.ordinal!, question, kind)) setAsked((prev) => new Set(prev).add(question));
        }
      : undefined;

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

          {!hasContent && <p className="text-sm text-fg/55">{pending ? "Summing up…" : "Nothing to sum up yet."}</p>}
          <Points label="You" items={topic.you} />
          <Points label={agent.Name} items={theirs} />

          {topic.ideas.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium tracking-wide text-fg/55 uppercase">{agent.Name}</h3>
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

          {comprehension && <Rethink comprehension={comprehension} ask={ask} asked={asked} />}

          <WorkspaceCards cards={cards.cards} matched={cards.topic?.title ?? null} loading={loading} ask={ask} asked={asked} />

          {ask && !topic.current && (
            <AskButton
              label="Bring it back up"
              done={asked.has(revisitQuestion(topic.title))}
              onAsk={() => ask(revisitQuestion(topic.title), "revisit")}
            />
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

const revisitQuestion = (title: string) => `Shall we go back to ${title}? What was still open there?`;

/** Ask me: hands the question to the agent; once taken, says so and stays put. */
function AskButton({ label = "Ask me", done, onAsk }: { label?: string; done: boolean; onAsk: () => void }) {
  return (
    <button
      type="button"
      disabled={done}
      onClick={onAsk}
      className="min-h-9 shrink-0 cursor-pointer rounded-full px-3 text-xs font-medium tracking-wide text-fg/70 uppercase ring-1 ring-fg/15 hover:text-fg disabled:cursor-default disabled:opacity-55"
    >
      {done ? "Asked" : label}
    </button>
  );
}

const HOLD_LABEL = { held: "yours", borrowed: "not yet yours", shaky: "shaky" } as const;

/**
 * What the comprehension monitor found (DRAFT): the ideas that are not yet
 * the person's, each with the evidence in a few words, and one check — a
 * small cognitive forcing function — to rethink the shakiest. Held ideas are
 * listed too, so the judgement reads as a mirror rather than a grade.
 */
function Rethink({
  comprehension,
  ask,
  asked,
}: {
  comprehension: TopicComprehension;
  ask: ((question: string, kind: SparkKind) => Promise<void>) | undefined;
  asked: ReadonlySet<string>;
}) {
  const { ideas, check } = comprehension;
  if (ideas.length === 0 && !check) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-amber-500/[0.08] p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-fg/60 uppercase">
        <Sparkle size={12} aria-hidden className="fill-current text-amber-600 dark:text-amber-300" />
        Rethink <span className="font-normal normal-case tracking-normal text-fg/45">· draft</span>
      </h3>
      {ideas.length > 0 && (
        <ul className="space-y-1.5">
          {ideas.map((idea, i) => (
            <li key={i} className="text-sm leading-snug">
              <span className="flex items-baseline gap-2">
                <span className={idea.hold === "held" ? "text-fg" : "text-fg/80"}>{idea.text}</span>
                <span
                  className={`ml-auto shrink-0 text-xs ${idea.hold === "held" ? "text-fg/45" : "text-amber-700 dark:text-amber-300"}`}
                >
                  {HOLD_LABEL[idea.hold]}
                </span>
              </span>
              {idea.hold !== "held" && idea.why && <span className="block text-xs text-fg/50">{idea.why}</span>}
            </li>
          ))}
        </ul>
      )}
      {check && (
        <div className="flex items-start gap-3 rounded-xl bg-surface p-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg/50">{CHECK_LABELS[check.kind]}</p>
            <p className="text-[15px] leading-snug text-fg">{check.question}</p>
          </div>
          {ask && (
            <AskButton
              done={asked.has(check.question)}
              onAsk={() => void ask(check.question, CHECK_AS_SPARK[check.kind])}
            />
          )}
        </div>
      )}
    </div>
  );
}

const KIND_HEADINGS: Record<TopicCard["kind"], string> = {
  task: "Tasks",
  claim: "What you think",
  question: "Open questions",
  fact: "Facts",
  context: "Background",
  meta: "Notes",
};

/**
 * What the workspace holds on this topic, from every drive: the cards the
 * workspace and board screens showed, grouped by kind. A question can be
 * handed to the agent to ask, live.
 */
function WorkspaceCards({
  cards,
  matched,
  loading,
  ask,
  asked,
}: {
  cards: readonly TopicCard[];
  /** The workspace topic's own name, when it differs from the conversation's. */
  matched: string | null;
  loading: boolean;
  ask: ((question: string, kind: SparkKind) => Promise<void>) | undefined;
  asked: ReadonlySet<string>;
}) {
  if (loading || cards.length === 0) return null;
  const groups = new Map<TopicCard["kind"], TopicCard[]>();
  for (const card of cards) groups.set(card.kind, [...(groups.get(card.kind) ?? []), card]);
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <h3 className="text-xs font-medium tracking-wide text-fg/55 uppercase">
        In your workspace{matched ? <span className="font-normal normal-case tracking-normal"> · {matched}</span> : null}
      </h3>
      {[...groups].map(([kind, list]) => (
        <div key={kind} className="space-y-1">
          <p className="text-xs text-fg/50">{KIND_HEADINGS[kind]}</p>
          <ul className="space-y-1.5">
            {list.map((card) => (
              <li key={card.id} className="flex items-start gap-2 text-[15px] leading-snug">
                <CardGlyph card={card} />
                <span className={`min-w-0 flex-1 ${card.state === "done" || card.state === "dropped" ? "text-fg/45 line-through" : "text-fg"}`}>
                  {card.label && <span className="text-fg/55">{card.label}: </span>}
                  {card.text}
                </span>
                {ask && card.kind === "question" && (
                  <AskButton done={asked.has(card.text)} onAsk={() => void ask(card.text, "decide")} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CardGlyph({ card }: { card: TopicCard }) {
  const cls = "mt-1 shrink-0 text-fg/45";
  if (card.kind === "question") return <HelpCircle size={14} aria-hidden className={cls} />;
  if (card.kind !== "task") return <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-fg/35" />;
  if (card.state === "done") return <Check size={14} aria-label="done" className={cls} />;
  if (card.state === "doing" || card.state === "next") return <CircleDot size={14} aria-label={card.state} className={cls} />;
  return <Circle size={14} aria-label="open" className={cls} />;
}
