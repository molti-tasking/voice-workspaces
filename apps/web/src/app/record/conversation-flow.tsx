"use client";

import { BookmarkCheck, BookmarkPlus, ChevronRight, FileText, Lock, Pencil, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { stripFillers } from "@voicemural/shared";
import { CopyButton } from "@/components/copy-button";
import { DraftMarkdown } from "@/components/draft-markdown";
import type { DraftCue } from "@/lib/display/use-cues";
import type { Floor } from "@/lib/recorder/floor-store";
import {
  EMPTY_CONVERSATION,
  MAX_TITLE_CHARS,
  cleanSubjectTitle,
  timeline,
  type ConversationStore,
  type Mark,
  type Run,
  type Turn,
} from "@/lib/talkback/conversation";
import { allSignals, type SubjectSignal } from "@/lib/talkback/signals";
import { EMPTY_LEDGER, type SparkLedger } from "@/lib/talkback/spark-ledger";
import { useAgentName } from "./agent-name-context";
import { SPARK_LABELS } from "./spark-chips";

/**
 * The drive's conversation: one column, both voices, in the order it was said.
 *
 * REPLACES THE TWO PANELS (talkback-23). The agent's turns in one panel and
 * theirs in another, each scrolling on its own and each filed by subject, put
 * a reply high on the left and what it answered low on the right: "the
 * sequence is not clear because it's going left, right" (drive of 20 Oct
 * 2026). And a return to a subject put the new lines under its old heading,
 * above everything since. Here every line is where it was said — theirs in a
 * bubble on the right, the agent's as plain text on the left, as in
 * `StudyConversation` — and a return is a new headline at the bottom.
 *
 * HEADLINES THAT FOLD. Each stretch of talk on one subject (`timeline` in
 * `conversation.ts`) sits under a headline naming it, with how many lines it
 * holds and what the recorder makes of it, in words. The stretch being talked
 * about now is open; earlier ones fold to their headline and open with a tap,
 * so the drive stays in order without the whole of it on screen.
 *
 * WHAT ELSE HAPPENED, WHERE IT HAPPENED. A draft the agent wrote is a line in
 * the conversation, after the turn that wrote it, and opens to its text with
 * Copy: "It's in your workspace and on this recording's page" was said to
 * somebody looking at this screen, which showed nothing. A spark they pulled
 * is a line too, before the question the agent asks with it. Drafts never
 * fold away; a folded stretch still shows them.
 *
 * WHAT THEY HOLD OF EACH SUBJECT, under its headline, in words: whose words it
 * is built on, whether they landed on something, how sure they sounded
 * (`signals.ts`). It used to be a bar with its meaning in an aria-label, and
 * was read as "how much do I understand". No numbers: it is an offer to look,
 * not a score. Keep, when the drive lets them choose, is on the headline, and
 * keeps the subject however many headlines it has.
 *
 * THEIR NAMES. A headline can be renamed (the pencil beside it): on screen,
 * on the stored subject, and with the agent, which calls it that from then on
 * (`renameSubject` in capture-provider.tsx). During the drive and after it.
 *
 * READABLE AS TEXT. The recorder blocks selection everywhere, so a stray hand
 * on a cradled phone selects nothing; the conversation opts back in, so a line
 * can be selected, copied, or dragged elsewhere. The controls stay unselectable.
 *
 * FOLLOWING, BY WHERE THE COLUMN IS. While the drive runs it stays at the end,
 * pinned instantly on every change: smooth scrolling restarted on every
 * streamed fragment, and juddered. Scrolling up, selecting text, opening a
 * stretch or a draft, or renaming stops it; scrolling back to the end, or
 * "Now ↓", starts it again. Nothing resumes on a timer, because a column that
 * jumps away from the line being read is the bug it was (20 Oct 2026): a
 * scroll up that began near the end used to count as being at the end, and
 * snapped back down.
 *
 * Never announced (`aria-live="off"`): a screen reader reading turns aloud
 * would talk over the conversation it shows. And `ph-no-capture`, because
 * PostHog's autocapture records the text of whatever is tapped, and these are
 * their words.
 */

/** Scrolling down to within this many pixels of the end starts following again. */
const FOLLOW_SLACK_PX = 80;

/** Who has the floor this second, for the line under the conversation. */
export interface FlowStatus {
  /** As the agent is under it; null until something is connected. */
  floor: Floor | null;
  /** The agent is talking. Wins a tie: its own voice can reach the microphone. */
  speaking: boolean;
  /** They are talking. */
  listening: boolean;
}

export function ConversationFlow({
  store,
  live,
  status,
  placeholder,
  keepable = false,
  sparks,
  drafts,
  onRename,
  className = "",
}: {
  store: ConversationStore;
  /** The drive is running: follow the newest line. After it, the column is a record. */
  live: boolean;
  /** The line under the conversation; null when talk-back is not running. */
  status: FlowStatus | null;
  /** Shown until anything has been said. */
  placeholder?: string;
  /** Each headline offers Keep (`sparkSelection: chosen`). */
  keepable?: boolean;
  /** The drive's sparks, in the sparks arm only: a headline with one on offer says so. */
  sparks: SparkLedger | null;
  /** The drive's drafts, by lineage, for the draft lines to open. */
  drafts: readonly DraftCue[];
  /** Rename a subject; false when it was refused (a name another subject has). */
  onRename?: (ordinal: number, title: string) => boolean;
  className?: string;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const ledger = useSyncExternalStore(
    sparks?.subscribe ?? noSubscription,
    sparks?.getSnapshot ?? emptyLedger,
    emptyLedger,
  );
  const runs = useMemo(() => timeline(state), [state]);
  // What is drawn does not depend on the clock, only the sparks' ranking does.
  const signals = useMemo(
    () => new Map(allSignals(state, 0).map((signal) => [signal.key, signal])),
    [state],
  );
  const offered = useMemo(() => new Set(ledger.offered.map((s) => s.ordinal)), [ledger]);
  const draftsById = useMemo(() => new Map(drafts.map((d) => [d.id, d])), [drafts]);
  const keptOrdinals = useMemo(
    () => new Set(state.sections.filter((s) => s.kept).map((s) => s.ordinal)),
    [state],
  );
  const keep = useCallback(
    (ordinal: number, kept: boolean) => store.dispatch({ type: "keep", ordinal, kept, via: "tap" }),
    [store],
  );
  const still = useReducedMotion();

  // A tap on a headline, overriding "open while current".
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  // Where the column was at its last scroll, so a scroll UP — theirs — can be
  // told from everything else: following only ever moves it down.
  const lastTop = useRef(0);
  const [following, setFollowing] = useState(true);
  const follow = live && following;

  // The scrollbar, where the system draws one that takes space (macOS with a
  // mouse, most desktops): moved out past the column's right edge, so the
  // conversation lines up with the controls under it instead of stopping
  // short of them. Zero for overlay scrollbars, as on phones.
  const [scrollbar, setScrollbar] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setScrollbar(el.offsetWidth - el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!follow || !el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [follow, state, drafts]);

  /** A selection inside the conversation: they are copying, so hold still. */
  const selecting = useCallback(() => {
    const selection = typeof document === "undefined" ? null : document.getSelection();
    const el = scroller.current;
    return Boolean(
      el && selection && !selection.isCollapsed && selection.anchorNode && el.contains(selection.anchorNode),
    );
  }, []);

  useEffect(() => {
    if (!live) return;
    const onSelection = () => {
      if (selecting()) setFollowing(false);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [live, selecting]);

  const resume = useCallback(() => setFollowing(true), []);

  const scrolled = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    const up = top < lastTop.current - 1;
    lastTop.current = top;
    if (!live) return;
    const fromEnd = el.scrollHeight - top - el.clientHeight;
    // Up, and not because the content shrank under a column at its end.
    if (up && fromEnd > 2) setFollowing(false);
    else if (!up && fromEnd <= FOLLOW_SLACK_PX && !selecting()) setFollowing(true);
  };

  /**
   * Open something and bring it into view, rather than following past it.
   * Scrolled within the column only: `scrollIntoView` would scroll the page
   * around it too.
   */
  const reveal = (event: MouseEvent<HTMLElement>, align: "start" | "nearest") => {
    setFollowing(false);
    const target = event.currentTarget.closest<HTMLElement>("[data-reveal]");
    window.requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || !target) return;
      const box = el.getBoundingClientRect();
      const at = target.getBoundingClientRect();
      const toTop = at.top - box.top - 8;
      const delta = align === "start" ? toTop : Math.min(Math.max(0, at.bottom - box.bottom + 8), toTop);
      if (Math.abs(delta) > 1) {
        el.scrollTo({ top: el.scrollTop + delta, behavior: still ? "auto" : "smooth" });
      }
    });
  };

  const current = runs.at(-1)?.current ? runs.at(-1) : undefined;
  const empty = runs.length === 0;

  // A drive that is over and said nothing live — talk-back was off, or never
  // connected — is one line, not an empty column.
  if (!live && empty) {
    return (
      <p className="rounded-2xl border border-line px-4 py-3 text-sm text-fg/55">
        Nothing from the live conversation to show. The transcript is on the
        recording&rsquo;s page.
      </p>
    );
  }

  return (
    <div className={`ph-no-capture relative flex min-h-0 flex-col ${className}`} aria-live="off">
      <div
        ref={scroller}
        onScroll={scrolled}
        style={scrollbar > 0 ? { marginRight: -scrollbar } : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain select-text [scrollbar-gutter:stable] [-webkit-touch-callout:default]"
      >
        <div className="flex w-full flex-col gap-4 py-3">
          {empty && <p className="text-fg/55">{placeholder}</p>}
          {runs.map((run) => {
            const open = toggled.get(run.id) ?? run.current;
            return (
              <RunView
                key={run.id}
                run={run}
                open={open}
                signal={signals.get(run.sectionKey)}
                sparkOnOffer={run.ordinal !== undefined && offered.has(run.ordinal)}
                kept={run.ordinal !== undefined && keptOrdinals.has(run.ordinal)}
                onKeep={keepable ? keep : undefined}
                onToggle={(event) => {
                  setToggled((t) => new Map(t).set(run.id, !open));
                  if (!open) reveal(event, "start");
                }}
                draftsById={draftsById}
                openDraft={openDraft}
                onDraft={(key, event) => {
                  setOpenDraft((was) => (was === key ? null : key));
                  if (openDraft !== key) reveal(event, "nearest");
                }}
                titleOf={(ordinal) =>
                  state.sections.find((s) => s.ordinal === ordinal)?.title ?? null
                }
                renaming={renaming === run.id}
                onStartRename={
                  onRename && run.ordinal !== undefined && run.title !== null
                    ? () => {
                        setFollowing(false);
                        setRenaming(run.id);
                      }
                    : undefined
                }
                onRename={(title) => {
                  if (!onRename || run.ordinal === undefined) return true;
                  const ok = onRename(run.ordinal, title);
                  if (ok) setRenaming(null);
                  return ok;
                }}
                onEndRename={() => setRenaming(null)}
              />
            );
          })}
        </div>
      </div>

      {live && !following && current && (
        // The way back to now, naming where now is.
        <button
          type="button"
          onClick={resume}
          // It floats over the column without being in it: a wheel over it
          // still scrolls the conversation.
          onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}
          className="vm-glass absolute select-none bottom-10 left-1/2 z-20 max-w-[80%] -translate-x-1/2 truncate rounded-full px-4 py-2 text-sm font-medium text-fg"
        >
          Now: {current.title ?? "…"} ↓
        </button>
      )}

      {status && <StatusLine status={status} />}
    </div>
  );
}

function RunView({
  run,
  open,
  signal,
  sparkOnOffer,
  kept,
  onKeep,
  onToggle,
  draftsById,
  openDraft,
  onDraft,
  titleOf,
  renaming,
  onStartRename,
  onRename,
  onEndRename,
}: {
  run: Run;
  open: boolean;
  signal: SubjectSignal | undefined;
  sparkOnOffer: boolean;
  kept: boolean;
  onKeep?: (ordinal: number, kept: boolean) => void;
  onToggle: (event: MouseEvent<HTMLElement>) => void;
  draftsById: ReadonlyMap<string, DraftCue>;
  openDraft: string | null;
  onDraft: (key: string, event: MouseEvent<HTMLElement>) => void;
  titleOf: (ordinal: number) => string | null;
  /** Their own name for the subject is being typed here. */
  renaming: boolean;
  /** Absent where a subject cannot be renamed yet: no name, or no number. */
  onStartRename?: () => void;
  /** False when the name was refused: another subject of the drive has it. */
  onRename: (title: string) => boolean;
  onEndRename: () => void;
}) {
  const reasons = signal?.reasons ?? [];
  const lines = run.turns === 1 ? "1 line" : `${run.turns} lines`;
  const meta = [...(open || run.turns === 0 ? [] : [lines]), ...reasons].join(" · ");
  // Folded, a stretch still shows its drafts: they are what was asked for.
  const items = open ? run.items : run.items.filter((i) => i.kind === "mark" && i.mark.kind === "draft");

  return (
    <section data-reveal className="flex flex-col gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <header className="flex items-start gap-1 select-none">
        {renaming && run.title !== null ? (
          <RenameField title={run.title} onRename={onRename} onCancel={onEndRename} />
        ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-1.5 py-1 text-left"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={[
              "mt-1 shrink-0 text-fg/45 transition-transform",
              open ? "rotate-90" : "",
            ].join(" ")}
          />
          <span className="block min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                // The current subject resolves in from a blur, again on every
                // new stretch of it; the others recede.
                key={run.current ? run.id : undefined}
                className={[
                  "truncate tracking-tight",
                  run.current ? "vm-title text-lg font-semibold text-fg" : "text-sm font-medium text-fg/60",
                ].join(" ")}
              >
                {run.isReturn && <span className="font-normal text-fg/50">Back to: </span>}
                {run.title ?? "…"}
              </span>
              {sparkOnOffer && (
                <Sparkles
                  size={13}
                  role="img"
                  aria-label="A spark is on offer for this subject"
                  className="shrink-0 text-amber-600 dark:text-amber-300"
                />
              )}
            </span>
            {meta && <span className="mt-0.5 block truncate text-xs text-fg/55">{meta}</span>}
          </span>
        </button>
        )}
        {onStartRename && !renaming && (
          <button
            type="button"
            onClick={onStartRename}
            aria-label={`Rename ${run.title ?? "this topic"}`}
            title="Rename"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg/40 transition-colors hover:bg-fg/[0.06] hover:text-fg/80"
          >
            <Pencil size={14} aria-hidden />
          </button>
        )}
        {onKeep && run.ordinal !== undefined && run.title !== null && (
          <KeepToggle kept={kept} title={run.title} onToggle={(k) => onKeep(run.ordinal!, k)} />
        )}
      </header>

      {items.map((item) =>
        item.kind === "turn" ? (
          <TurnLine key={item.turn.id} turn={item.turn} />
        ) : item.mark.kind === "draft" ? (
          <DraftLine
            key={item.mark.key}
            mark={item.mark}
            draft={draftsById.get(item.mark.draftId)}
            open={openDraft === item.mark.key}
            onToggle={(event) => onDraft(item.mark.key, event)}
          />
        ) : (
          <SparkLine key={item.mark.key} mark={item.mark} title={titleOf(item.mark.ordinal)} />
        ),
      )}
    </section>
  );
}

/**
 * Their own name for a subject, typed over the headline. Enter or leaving the
 * field keeps it; Escape keeps the old one. A name another subject of this
 * drive already has is refused, and said so, because the two would become
 * one subject to the container.
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
    if (!next || next === title) {
      done.current = true;
      onCancel();
      return;
    }
    if (onRename(next)) {
      done.current = true;
      return;
    }
    // Refused. Typed on, they can fix it; walked away from, it is dropped.
    if (fromBlur) {
      done.current = true;
      onCancel();
    } else {
      setTaken(true);
    }
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
        // Opened by their tap on the pencil, to type into.
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
        // 16px, so iOS does not zoom in on it; selectable inside a screen
        // that is not.
        className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base text-fg select-text"
      />
      {taken && <span className="text-xs text-amber-700 dark:text-amber-300/80">Another topic already has that name.</span>}
    </form>
  );
}

function TurnLine({ turn }: { turn: Turn }) {
  return turn.who === "user" ? (
    // Their fillers are counted (`signals.ts`), not shown: "um" on a screen
    // reads as a transcription fault.
    <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-fg/[0.07] px-4 py-2.5 leading-relaxed">
      {stripFillers(turn.text)}
    </p>
  ) : (
    <p className="max-w-[95%] leading-relaxed text-fg/90">
      {turn.text}
      {/* Cut off — by them talking, or by a Lock. Said, because a reply that
          stops mid-sentence otherwise reads as a rendering fault. */}
      {turn.interrupted && (
        <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300/80">cut off</span>
      )}
    </p>
  );
}

/**
 * A draft, where the agent wrote it. Every line of one draft opens the same,
 * newest text: a rewrite is a second line where it was asked for, never a
 * stale copy. Editing and the earlier versions stay on the recording's page.
 */
function DraftLine({
  mark,
  draft,
  open,
  onToggle,
}: {
  mark: Extract<Mark, { kind: "draft" }>;
  draft: DraftCue | undefined;
  open: boolean;
  onToggle: (event: MouseEvent<HTMLElement>) => void;
}) {
  const label = mark.major > 1 ? "Draft updated" : "Draft";
  return (
    <div data-reveal className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={draft ? open : undefined}
        disabled={!draft}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2 text-left text-sm disabled:cursor-default"
      >
        <FileText size={15} aria-hidden className="shrink-0 text-sky-700 dark:text-sky-300" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{label}</span>
          {" · "}
          {draft ? draft.title || "Untitled" : "on the recording's page"}
        </span>
        <span className="shrink-0 text-xs text-fg/55">v{mark.major}</span>
        {draft && (
          <ChevronRight
            size={15}
            aria-hidden
            className={["shrink-0 text-fg/45 transition-transform", open ? "rotate-90" : ""].join(" ")}
          />
        )}
      </button>
      {open && draft && (
        <div className="rounded-xl border border-line bg-surface/40 p-3">
          <div className="mb-2 flex items-start gap-3">
            <p className="min-w-0 flex-1 text-xs text-fg/55">
              {draft.version}, the latest. Versions and editing are on the recording&rsquo;s page
              after you stop.
            </p>
            <CopyButton text={draft.text} />
          </div>
          <DraftMarkdown
            text={draft.text}
            className="max-h-[50dvh] overflow-y-auto text-sm leading-relaxed select-text"
          />
        </div>
      )}
    </div>
  );
}

/** A spark they pulled: the question the agent is about to ask, and on what. */
function SparkLine({ mark, title }: { mark: Extract<Mark, { kind: "spark" }>; title: string | null }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-fg/65">
      <Sparkles size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
      <span className="min-w-0">
        You asked: {mark.question ?? SPARK_LABELS[mark.spark]}
        {title && <span className="text-fg/50"> · {title}</span>}
      </span>
    </p>
  );
}

/**
 * Keep: hold this subject in your own head. Tapped again, the keep is taken
 * back and Souffleur holds it. The person's choice, made where the subject
 * is — never preselected, and nothing happens on its own.
 */
function KeepToggle({
  kept,
  title,
  onToggle,
}: {
  kept: boolean;
  title: string;
  onToggle: (kept: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={kept}
      aria-label={kept ? `Kept: ${title}. Tap to let Souffleur hold it` : `Keep ${title} in your own head`}
      onClick={() => onToggle(!kept)}
      className={[
        "flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium tracking-wide uppercase transition-colors",
        kept ? "bg-fg/12 text-fg ring-1 ring-fg/25" : "text-fg/60 ring-1 ring-fg/15 hover:text-fg/80",
      ].join(" ")}
    >
      {kept ? <BookmarkCheck size={14} aria-hidden /> : <BookmarkPlus size={14} aria-hidden />}
      {kept ? "Kept" : "Keep"}
    </button>
  );
}

/**
 * One line under the conversation: who has the floor this second. Turn-taking
 * is what the study is about, so this is the one thing on the screen worth
 * catching from the corner of an eye — and in one column there is no panel to
 * light up. Every display draws this same line (`ConversationDisplay`), so
 * the display study compares what is shown of the conversation, not whether
 * the screen says who is talking.
 */
export function StatusLine({ status }: { status: FlowStatus }) {
  const { floor, speaking, listening } = status;
  const agent = useAgentName();
  return (
    <p className="flex h-7 w-full shrink-0 items-center gap-2 text-sm text-fg/55 select-none">
      {speaking ? (
        <>
          <SpeakingBars />
          <span className="text-sky-700 dark:text-sky-300">{agent.Name} is speaking</span>
        </>
      ) : listening ? (
        <>
          <SpeakingBars />
          <span className="text-fg/80">Listening</span>
        </>
      ) : floor === "locked" ? (
        <>
          <Lock size={13} aria-hidden />
          <span>Locked: {agent.name} only talks when you poke it</span>
        </>
      ) : floor === null ? (
        <span>Connecting…</span>
      ) : (
        <span>Your turn</span>
      )}
    </p>
  );
}

/** Three bars rising and falling: someone is talking. Still, for reduced motion. */
function SpeakingBars() {
  return (
    <span className="vm-speaking flex h-3 items-end gap-[2px]" role="img" aria-label="speaking">
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}

function noSubscription(): () => void {
  return () => {};
}

function emptyLedger() {
  return EMPTY_LEDGER;
}

/** Whether the viewer has asked for less motion, live. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, readMotion, () => false);
}

function motionQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
}

function subscribeToMotion(onChange: () => void): () => void {
  const query = motionQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function readMotion(): boolean {
  return motionQuery()?.matches ?? false;
}
