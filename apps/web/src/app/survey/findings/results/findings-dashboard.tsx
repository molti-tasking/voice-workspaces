"use client";

import { ChevronLeft, ChevronRight, Link2, Pin, Presentation, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FindingsTextField } from "@voicemural/shared";
import { useLocalValue, writeLocalValue } from "@/lib/local-value";
import { median, summarise, type FindingsResponse, type FindingsSummary, type Quote } from "../summary";
import * as W from "../wording";
import {
  BarList,
  ChartCard,
  DotStrip,
  HandOffChart,
  StatTile,
  handOffTable,
  scaleTable,
  tallyTable,
} from "./charts";

/**
 * The findings survey's results, for the researcher — and tomorrow's slides.
 *
 * LIVE WHILE OPEN. It re-reads the server every 20 seconds while the tab is
 * visible, so answers arriving after the invitation goes out appear without a
 * reload; the frame holds while it does, nothing flashes.
 *
 * PINS AND PRESENT. Free-text answers are listed in full here and nowhere
 * else. Pinning one puts it on the matching slide in Present mode, which is
 * what goes on the wall at the workshop: the four findings with their
 * counts, and only the words the researcher chose to show. Pins live in this
 * browser's storage, so they are the researcher's own and never shared.
 */

const REFRESH_MS = 20_000;
const PINS_KEY = "souffleur.findings.pins";

/* --- Pins ------------------------------------------------------------------ */

function usePins() {
  const raw = useLocalValue(PINS_KEY);
  const pins = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(raw ?? "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(pins);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeLocalValue(PINS_KEY, JSON.stringify([...next]));
    },
    [pins],
  );
  return [pins, toggle] as const;
}

/* --- Sections --------------------------------------------------------------- */

interface Section {
  key: string;
  eyebrow: string;
  title: string;
  statement?: string;
  charts: ReactNode[];
  /** Hand-off is wide; the others sit two to a row. */
  wide?: boolean;
  textFields: FindingsTextField[];
}

function caption(answered: number, respondents: number, extra?: string): string {
  const base = `${answered} of ${respondents} answered`;
  return extra ? `${base} · ${extra}` : base;
}

function sections(s: FindingsSummary, size: "normal" | "large"): Section[] {
  const [f1, f2, f3, f4] = W.FINDINGS;
  const silenceMedian = median(s.silence.values);
  return [
    {
      key: "finding-1",
      eyebrow: `Finding ${f1.n}`,
      title: f1.title,
      statement: f1.statement,
      charts: [
        <ChartCard
          key="silence"
          size={size}
          title={W.SILENCE_MATCH.question}
          caption={caption(
            s.silence.answered,
            s.respondents,
            `${s.silence.notApplicable} said it didn't come up` +
              (silenceMedian !== null ? ` · median ${silenceMedian}` : ""),
          )}
          table={scaleTable(s.silence.values, 5)}
        >
          <DotStrip values={s.silence.values} points={5} low={W.SILENCE_MATCH.low} high={W.SILENCE_MATCH.high} />
        </ChartCard>,
      ],
      textFields: ["silenceWanted"],
    },
    {
      key: "finding-2",
      eyebrow: `Finding ${f2.n}`,
      title: f2.title,
      statement: f2.statement,
      charts: [
        <ChartCard
          key="reasons"
          size={size}
          title={W.USE_REASONS_QUESTION}
          caption={caption(s.useReasons.answered, s.respondents, "several could be ticked")}
          table={tallyTable(s.useReasons.tallies, W.USE_REASON_LABELS)}
        >
          <BarList tallies={s.useReasons.tallies} labels={W.USE_REASON_LABELS} of={s.useReasons.answered} />
        </ChartCard>,
      ],
      textFields: ["learned", "useReasonOther"],
    },
    {
      key: "finding-3",
      eyebrow: `Finding ${f3.n}`,
      title: f3.title,
      statement: f3.statement,
      charts: [
        <ChartCard
          key="arrival"
          size={size}
          title={W.ARRIVAL_QUESTION}
          caption={caption(s.arrival.answered, s.respondents)}
          table={tallyTable(s.arrival.tallies, W.ARRIVAL_LABELS)}
        >
          <BarList tallies={s.arrival.tallies} labels={W.ARRIVAL_LABELS} of={s.arrival.answered} />
        </ChartCard>,
        <ChartCard
          key="wrap-up"
          size={size}
          title={W.WRAP_UP_QUESTION}
          caption={caption(s.wrapUp.answered, s.respondents)}
          table={tallyTable(s.wrapUp.tallies, W.WRAP_UP_LABELS)}
        >
          <BarList tallies={s.wrapUp.tallies} labels={W.WRAP_UP_LABELS} of={s.wrapUp.answered} />
        </ChartCard>,
      ],
      textFields: ["wrapUpWhy", "arrivalOther"],
    },
    {
      key: "finding-4",
      eyebrow: `Finding ${f4.n}`,
      title: f4.title,
      statement: f4.statement,
      wide: true,
      charts: [
        <ChartCard
          key="hand-off"
          size={size}
          title={W.HAND_OFF_QUESTION}
          caption="Sorted from most handed over to most kept. The centre line is “only if I can check it later”."
          table={handOffTable(s.handOff, W.HAND_OFF_TASK_LABELS, W.HAND_OFF_ANSWER_LABELS)}
        >
          <HandOffChart rows={s.handOff} taskLabels={W.HAND_OFF_TASK_LABELS} answerLabels={W.HAND_OFF_ANSWER_LABELS} />
        </ChartCard>,
      ],
      textFields: ["neverDo"],
    },
    {
      key: "overall",
      eyebrow: "Overall",
      title: "How they rate it",
      charts: [
        <ChartCard
          key="umux-capabilities"
          size={size}
          title={W.UMUX_CAPABILITIES.question}
          caption={caption(s.umux.capabilities.length, s.respondents)}
          table={scaleTable(s.umux.capabilities, 7)}
        >
          <DotStrip
            values={s.umux.capabilities}
            points={7}
            low={W.UMUX_CAPABILITIES.low}
            high={W.UMUX_CAPABILITIES.high}
          />
        </ChartCard>,
        <ChartCard
          key="umux-ease"
          size={size}
          title={W.UMUX_EASE.question}
          caption={caption(s.umux.ease.length, s.respondents)}
          table={scaleTable(s.umux.ease, 7)}
        >
          <DotStrip values={s.umux.ease} points={7} low={W.UMUX_EASE.low} high={W.UMUX_EASE.high} />
        </ChartCard>,
        <ChartCard
          key="keep-using"
          size={size}
          title={W.KEEP_USING_QUESTION}
          caption={caption(s.keepUsing.answered, s.respondents)}
          table={tallyTable(s.keepUsing.tallies, W.KEEP_USING_LABELS)}
        >
          <BarList tallies={s.keepUsing.tallies} labels={W.KEEP_USING_LABELS} of={s.keepUsing.answered} />
        </ChartCard>,
      ],
      textFields: [],
    },
    {
      key: "questions",
      eyebrow: "For the workshop",
      title: "Your questions",
      charts: [],
      textFields: ["workshopQuestion"],
    },
  ];
}

/* --- The page --------------------------------------------------------------- */

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function FindingsDashboard({ responses, loadedAt }: { responses: FindingsResponse[]; loadedAt: string }) {
  const router = useRouter();
  const summary = useMemo(() => summarise(responses), [responses]);
  const [pins, togglePin] = usePins();
  const [slide, setSlide] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/survey/findings`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused; the link is also shown in the empty state */
    }
  };

  const keep = summary.keepUsing.tallies;
  const keepYes = keep.filter((t) => t.key !== "no").reduce((sum, t) => sum + t.count, 0);
  const umuxMedian = median(summary.umux.scores);
  const silenceMedian = median(summary.silence.values);
  const all = sections(summary, "normal");

  return (
    <div className="mx-auto max-w-5xl vm-page-top px-6 pb-40">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">Findings survey · results</p>
          <h1 className="text-2xl font-semibold">What they made of the four findings</h1>
          <p className="mt-1 text-sm text-fg/55">
            Updates every 20 seconds · last read{" "}
            <time dateTime={loadedAt} suppressHydrationWarning>
              {formatTime(loadedAt)}
            </time>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToolButton onClick={() => router.refresh()} icon={<RefreshCw size={14} aria-hidden />}>
            Refresh
          </ToolButton>
          <ToolButton onClick={() => void copyLink()} icon={<Link2 size={14} aria-hidden />}>
            {copied ? "Copied" : "Copy survey link"}
          </ToolButton>
          <ToolButton
            onClick={() => setSlide(0)}
            disabled={summary.respondents === 0}
            icon={<Presentation size={14} aria-hidden />}
          >
            Present
          </ToolButton>
        </div>
      </header>

      {summary.respondents === 0 && (
        <p className="mb-8 rounded-xl border border-line bg-surface p-5 text-sm text-fg/70">
          No answers yet. The survey is at <span className="font-mono text-fg">/survey/findings</span> — anyone
          with the link can answer, without an account.
        </p>
      )}

      <section aria-label="Headline figures" className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Responses" value={String(summary.respondents)} detail="anonymous; day sent only" />
        <StatTile
          label="Would keep using it"
          value={summary.keepUsing.answered ? `${keepYes} of ${summary.keepUsing.answered}` : "—"}
          detail="regularly or for certain drives"
        />
        <StatTile
          label="UMUX-Lite"
          value={umuxMedian !== null ? String(Math.round(umuxMedian)) : "—"}
          detail={`median of ${summary.umux.scores.length}, on 0–100`}
        />
        <StatTile
          label="Silence finding matched"
          value={silenceMedian !== null ? `${silenceMedian} / 5` : "—"}
          detail={`median of ${summary.silence.values.length} · ${summary.silence.notApplicable} n/a`}
        />
      </section>

      <section aria-labelledby="who" className="mb-12">
        <h2 id="who" className="mb-3 text-sm font-medium tracking-wide text-fg/60 uppercase">
          Who answered
        </h2>
        <ChartCard
          title={W.USAGE_QUESTION}
          caption={`${caption(summary.usage.answered, summary.respondents)} · not used to split any other answer`}
          table={tallyTable(summary.usage.tallies, W.USAGE_LABELS)}
        >
          <BarList tallies={summary.usage.tallies} labels={W.USAGE_LABELS} of={summary.usage.answered} />
        </ChartCard>
      </section>

      <div className="space-y-14">
        {all.map((section) => (
          <section key={section.key} aria-labelledby={section.key} className="space-y-5">
            <SectionHeader section={section} />
            <SectionBody
              section={section}
              quotes={section.textFields.map((field) => (
                <QuoteList
                  key={field}
                  title={W.TEXT_FIELD_LABELS[field]}
                  quotes={summary.quotes[field]}
                  pins={pins}
                  onToggle={togglePin}
                />
              ))}
            />
          </section>
        ))}
      </div>

      {slide !== null && (
        <Presenter
          slides={sections(summary, "large")}
          quotes={summary.quotes}
          pins={pins}
          index={slide}
          onIndex={setSlide}
          onClose={() => setSlide(null)}
        />
      )}
    </div>
  );
}

function ToolButton({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-sm text-fg/80 ring-1 ring-fg/15 hover:text-fg hover:ring-fg/30 disabled:cursor-default disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A lone chart takes the left column and its written answers the right, so
 * the numbers and the words about them are read side by side. Two charts, or
 * a wide one, sit above the answers instead.
 */
function SectionBody({ section, quotes }: { section: Section; quotes: ReactNode[] }) {
  if (section.charts.length === 1 && !section.wide && quotes.length > 0) {
    return (
      <div className="grid items-start gap-4 md:grid-cols-2">
        {section.charts}
        <div className="space-y-4">{quotes}</div>
      </div>
    );
  }
  return (
    <>
      {section.charts.length > 0 && (
        <div className={section.wide ? "grid gap-4" : "grid gap-4 md:grid-cols-2"}>{section.charts}</div>
      )}
      {quotes}
    </>
  );
}

function SectionHeader({ section, large = false }: { section: Section; large?: boolean }) {
  return (
    <header>
      <p className={large ? "mb-2 font-mono text-sm text-fg/50" : "mb-1 font-mono text-xs text-fg/45"}>
        {section.eyebrow}
      </p>
      <h2 id={section.key} className={large ? "text-3xl font-semibold" : "text-lg font-medium"}>
        {section.title}
      </h2>
      {section.statement && (
        <p className={large ? "mt-3 max-w-3xl text-xl leading-relaxed text-fg/75" : "mt-1 text-sm leading-relaxed text-fg/65"}>
          {section.statement}
        </p>
      )}
    </header>
  );
}

function QuoteList({
  title,
  quotes,
  pins,
  onToggle,
}: {
  title: string;
  quotes: Quote[];
  pins: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="mb-3 text-sm font-medium text-fg">
        {title} <span className="ml-1 text-xs font-normal text-fg/45 tabular-nums">{quotes.length}</span>
      </h3>
      {quotes.length === 0 ? (
        <p className="text-sm text-fg/45">Nothing written yet.</p>
      ) : (
        <ul className="space-y-2">
          {quotes.map((quote) => {
            const pinned = pins.has(quote.id);
            return (
              <li key={quote.id} className="flex items-start gap-2 rounded-lg bg-fg/[0.04] px-3 py-2">
                <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap text-fg/85">{quote.text}</p>
                <button
                  type="button"
                  aria-pressed={pinned}
                  aria-label={pinned ? "Unpin from the presentation" : "Pin to the presentation"}
                  title={pinned ? "Shown in Present" : "Show in Present"}
                  onClick={() => onToggle(quote.id)}
                  className={[
                    "shrink-0 cursor-pointer rounded-md p-1.5 transition-colors",
                    pinned ? "bg-fg/12 text-fg" : "text-fg/40 hover:text-fg/70",
                  ].join(" ")}
                >
                  <Pin size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* --- Present ---------------------------------------------------------------- */

/**
 * One section per screen, large, for a room. Shows the counts and only the
 * pinned words: the dashboard lists everything, the wall shows what the
 * researcher chose.
 */
function Presenter({
  slides,
  quotes,
  pins,
  index,
  onIndex,
  onClose,
}: {
  slides: Section[];
  quotes: Record<FindingsTextField, Quote[]>;
  pins: Set<string>;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const last = slides.length - 1;
  const go = useCallback((next: number) => onIndex(Math.max(0, Math.min(last, next))), [onIndex, last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") go(index + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onClose]);

  const section = slides[index];
  if (!section) return null;
  const shown = section.textFields.flatMap((field) => quotes[field].filter((q) => pins.has(q.id)));

  return (
    <div role="dialog" aria-modal="true" aria-label="Presentation" className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-8 py-8">
        <div className="mb-8 flex items-center justify-between gap-4 text-sm text-fg/55">
          <span className="tabular-nums">
            {index + 1} / {slides.length}
          </span>
          <div className="flex items-center gap-1">
            <IconButton label="Previous" onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft size={18} aria-hidden />
            </IconButton>
            <IconButton label="Next" onClick={() => go(index + 1)} disabled={index === last}>
              <ChevronRight size={18} aria-hidden />
            </IconButton>
            <IconButton label="Close the presentation" onClick={onClose}>
              <X size={18} aria-hidden />
            </IconButton>
          </div>
        </div>

        <div className="flex-1 space-y-8">
          <SectionHeader section={section} large />
          {section.charts.length > 0 && (
            <div className={section.wide ? "grid gap-5" : "grid gap-5 md:grid-cols-2"}>{section.charts}</div>
          )}
          {shown.length > 0 && (
            <ul className="space-y-4">
              {shown.map((quote) => (
                <li key={quote.id}>
                  <blockquote className="border-l-2 border-line pl-5 text-xl leading-relaxed text-fg/85">
                    “{quote.text}”
                  </blockquote>
                </li>
              ))}
            </ul>
          )}
          {shown.length === 0 && section.textFields.length > 0 && section.charts.length === 0 && (
            <p className="text-lg text-fg/50">Pin answers on the dashboard to show them here.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-full p-2 text-fg/70 hover:bg-fg/8 hover:text-fg disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  );
}
