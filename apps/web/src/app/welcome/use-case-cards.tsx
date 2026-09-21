import {
  Copy,
  Globe,
  History,
  Lightbulb,
  PenLine,
  type LucideIcon,
} from "lucide-react";

/**
 * One line of a worked example, in the order it would happen.
 *
 * - `you`     something the person says, drawn as the transcript draws it
 * - `agent`   what the system says back, drawn as `AgentTurnBubble` draws it
 * - `quiet`   a stretch where it deliberately says nothing
 * - `later`   a break between two drives, for the example that needs two
 * - `board`   a card appearing on the task board, drawn as `board-card.tsx`
 * - `draft`   a draft appearing on the recorder, drawn as `draft-panel.tsx`
 */
type Beat =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "quiet"; text: string }
  | { kind: "later"; text: string }
  | { kind: "board"; topic: string; text: string; column: string }
  | { kind: "draft"; title: string; version: number; text: string };

interface UseCase {
  id: string;
  icon: LucideIcon;
  title: string;
  /** What it is for, in one line. */
  promise: string;
  beats: Beat[];
  /** The one sentence that separates this from a voice memo. */
  point: string;
}

/**
 * Every line here is something the system has actually done, and the
 * comments say where. This page exists because two people could not tell what
 * could be said into the microphone, and an example that does not work when
 * repeated teaches them the opposite of what it says.
 */
const USE_CASES: UseCase[] = [
  {
    id: "think_aloud",
    icon: Lightbulb,
    title: "Think a problem out, and come back to a board",
    promise:
      "Talk through something unresolved. It mostly listens, and what you decide ends up as cards you can see afterwards.",
    beats: [
      {
        kind: "you",
        text: "I need to work out how to structure the method section. Let me think out loud for a bit.",
      },
      // The driving profile's proactivity is "quiet" (setting.ts): most landed
      // thoughts pass without comment, on purpose.
      { kind: "quiet", text: "It stays quiet while you think, and speaks up only when a thought lands." },
      {
        kind: "you",
        text: "Right, that's decided — interviews first, then the survey. Add a task: rewrite the method outline.",
      },
      // `add_task` in board-tools.ts, offered wherever the board is enabled.
      { kind: "agent", text: "Added it under next." },
      {
        kind: "board",
        topic: "Method section",
        text: "Rewrite the method outline",
        column: "next",
      },
    ],
    point:
      "A recording app keeps the audio. This keeps the decision, as a card you can drag. “Mark that one done” and “drop that” move cards too.",
  },
  {
    id: "draft",
    icon: PenLine,
    title: "Get something written you can paste",
    promise:
      "Ask for an email, a message or notes. It writes them to the screen instead of reading them at you, and you can change them by voice.",
    beats: [
      { kind: "you", text: "Draft me a message to my sister with the action items from this." },
      // The keep section in prompt.ts: one short line outside the tags, the
      // draft itself is never read aloud.
      { kind: "agent", text: "It's on the screen." },
      {
        kind: "draft",
        title: "Message to your sister",
        version: 1,
        text: "Hi — three things from today: I'll book the flights, you call Mum about the dates, and we both send Dad our lists by Friday. Sound OK?",
      },
      { kind: "you", text: "Make it shorter, and warmer." },
      // talkback-12: `revises` turns the second ask into the next version of
      // the same draft rather than a second card.
      { kind: "agent", text: "Done — same draft, shorter." },
      {
        kind: "draft",
        title: "Message to your sister",
        version: 2,
        text: "Hey you — I'll book the flights, you ring Mum about dates, lists to Dad by Friday. Can't wait. x",
      },
    ],
    point:
      "The second ask revises the same draft rather than producing a second one. “Fix the name” and “add a line about the car” work the same way.",
  },
  {
    id: "recall",
    icon: History,
    title: "Pick the thread up another day",
    promise:
      "Record something today, then start a second drive another day and ask where you got to.",
    beats: [
      {
        kind: "you",
        text: "The ethics form is stuck until I've written the data-management plan.",
      },
      { kind: "later", text: "a few days later, a new drive" },
      { kind: "you", text: "Where did I get to on the ethics form?" },
      // retrieval.ts: passages come back dated as a person would say it —
      // "earlier today", "yesterday", "3 days ago", "last week".
      {
        kind: "agent",
        text: "Three days ago you said it's stuck until the data-management plan is written. Nothing since.",
      },
    ],
    point:
      "It answers from what you actually said, and says roughly when. This is the one that needs two drives, and the one that is most clearly not a voice memo.",
  },
  {
    id: "look_up",
    icon: Globe,
    title: "Ask it to look something up",
    promise:
      "A date, a deadline, a figure, a name. It says what it is looking up while it searches, so you are never talking into silence.",
    beats: [
      { kind: "you", text: "Is the library open on Sunday?" },
      // web-search.ts: the `announcement` is spoken the moment the call
      // arrives, and a cue plays until the result is back.
      { kind: "agent", text: "Let me look up the library's opening hours." },
      { kind: "agent", text: "Yes — ten till four on Sundays." },
    ],
    point:
      "Only the search words leave; nothing else from the drive is sent. Say “just find it online” if it asks you for details you do not have.",
  },
];

/**
 * The worked examples, each shown as the conversation it would be.
 *
 * Drawn with the SAME shapes as the real screens — the transcript's grey line
 * for what you said, the sky bubble for what it said, a board card, a draft
 * card — so the first time a reader sees the recorder or the board, they have
 * already seen it. The mock-ups are `aria-hidden` and inert: the promise, the
 * spoken lines and the point are all in the text, and the pictures repeat
 * rather than replace them.
 *
 * Nothing here is a link or a button. A drive started from a card would carry
 * `useCase` (see `/api/capture-sessions`), and the first version of this page
 * did that; the plain list won because a study drive should begin from what
 * the person wanted to say, not from which card was nearest the thumb.
 */
export function UseCaseCards() {
  return (
    <ol className="space-y-4">
      {USE_CASES.map((useCase) => {
        const Icon = useCase.icon;
        return (
          <li key={useCase.id}>
            <article className="overflow-hidden rounded-xl border border-line bg-ink-soft/40">
              <header className="flex items-start gap-3 px-5 pt-5 pb-3">
                <span
                  className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70"
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-medium">{useCase.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/60">{useCase.promise}</p>
                </div>
              </header>

              <Conversation beats={useCase.beats} />

              <p className="px-5 pt-3 pb-5 text-xs leading-relaxed text-white/40">
                {useCase.point}
              </p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The example as it would play out, one beat per line.
 *
 * Spoken lines are ALSO in the accessible tree as a plain list, because a
 * reader with a screen reader is the reader who most needs to know what to
 * say. The drawn cards are decorative repeats of the sentence before them.
 */
function Conversation({ beats }: { beats: Beat[] }) {
  return (
    <div className="border-y border-line bg-black/20 px-4 py-4">
      <ol className="space-y-2.5">
        {beats.map((beat, i) => (
          <li key={i}>
            <BeatView beat={beat} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function BeatView({ beat }: { beat: Beat }) {
  switch (beat.kind) {
    case "you":
      return (
        // The transcript's own line for the driver: `UserLine` in
        // sessions/[id]/transcript.tsx, minus the timestamp gutter.
        <div className="flex flex-col items-start pr-10">
          <span className="mb-0.5 text-[10px] font-medium tracking-wide text-white/30 uppercase">
            you
          </span>
          <p className="inline-block max-w-full rounded-lg rounded-tl-sm bg-white/[0.04] px-3 py-1.5 text-sm text-white">
            {beat.text}
          </p>
        </div>
      );
    case "agent":
      return (
        // `AgentTurnBubble`, without the turn number: this is an example, not a
        // record.
        <div className="flex flex-col items-end pl-10">
          <span className="mb-0.5 text-[10px] font-medium tracking-wide text-sky-300/70 uppercase">
            agent
          </span>
          <p className="inline-block max-w-full rounded-lg rounded-tr-sm border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-sm text-sky-50">
            {beat.text}
          </p>
        </div>
      );
    case "quiet":
      return <p className="py-1 text-center text-xs text-white/30 italic">{beat.text}</p>;
    case "later":
      return (
        <p className="flex items-center gap-3 py-1 text-[11px] text-white/30">
          <span className="h-px flex-1 bg-white/10" aria-hidden />
          <span>{beat.text}</span>
          <span className="h-px flex-1 bg-white/10" aria-hidden />
        </p>
      );
    case "board":
      return (
        // `board-card.tsx`, at the size it has on the board, under the name
        // of the column it lands in.
        <div className="flex flex-col items-end pl-10" aria-hidden>
          <span className="mb-0.5 text-[10px] font-medium tracking-wide text-white/30 uppercase">
            on the board · {beat.column}
          </span>
          <div className="w-full max-w-[260px] rounded-xl border border-line bg-ink-soft/40 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/30">
              <Lightbulb size={12} className="shrink-0" />
              <span className="truncate">{beat.topic}</span>
            </p>
            <p className="text-sm leading-snug">{beat.text}</p>
            <p className="mt-1.5 text-[11px] text-white/30">said just now · 1 utterance</p>
          </div>
        </div>
      );
    case "draft":
      return (
        // `draft-panel.tsx`, including the version label that is the only
        // visible evidence a revision happened.
        <div className="flex flex-col items-end pl-10" aria-hidden>
          <span className="mb-0.5 text-[10px] font-medium tracking-wide text-white/30 uppercase">
            on the screen
          </span>
          <div className="w-full max-w-[300px] rounded-xl border border-line bg-ink-soft/40 p-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] tracking-wide text-white/40 uppercase">
                {beat.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-white/25 tabular-nums">
                v{beat.version}
              </span>
              <span className="flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-white/50">
                <Copy size={11} />
                Copy
              </span>
            </div>
            <p className="text-[13px] leading-snug text-white/85">{beat.text}</p>
          </div>
        </div>
      );
  }
}
