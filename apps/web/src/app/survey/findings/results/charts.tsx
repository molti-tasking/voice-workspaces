"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import type { HandOffAnswer, HandOffTask } from "@voicemural/shared";
import type { HandOffRow, Tally } from "../summary";

/**
 * The charts on the findings results page, in plain HTML.
 *
 * Built to the dataviz rules rather than with a chart library: one series
 * colour (`viz-1`) for counts, the blue/neutral/orange ordered scale for the
 * hand-off question, thin bars with a 4px rounded data end, a 2px surface
 * gap between touching segments, values in text tokens, and every value
 * reachable without hovering — through a label, the table view, or both.
 * Every mark's hover target is its whole row or column, never the painted
 * pixels alone.
 */

/* --- Tooltip -------------------------------------------------------------- */

interface TipState {
  x: number;
  y: number;
  value: string;
  label: string;
}

/**
 * One tooltip per chart. `bind` goes on each hit target, and the chart's
 * outer element carries `data-tip-root` — the tooltip is placed relative to
 * it, found from the target, so no ref has to be read during render. The
 * same details show on keyboard focus as on hover.
 */
function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);

  const place = (el: Element, value: string, label: string, clientX?: number, clientY?: number) => {
    const box = el.closest("[data-tip-root]")?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    setTip({
      x: (clientX ?? r.left + r.width / 2) - box.left,
      y: (clientY ?? r.top) - box.top,
      value,
      label,
    });
  };

  const bind = (value: string, label: string) => ({
    tabIndex: 0,
    "aria-label": `${label}: ${value}`,
    onPointerMove: (e: React.PointerEvent<HTMLElement>) =>
      place(e.currentTarget, value, label, e.clientX, e.clientY),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => place(e.currentTarget, value, label),
    onBlur: () => setTip(null),
  });

  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      <span className="block font-semibold text-fg tabular-nums">{tip.value}</span>
      <span className="block text-fg/60">{tip.label}</span>
    </div>
  ) : null;

  return { bind, node };
}

/**
 * The rendered width of an element, kept current. Takes the element through
 * a callback ref into state, so the width is state too and render reads no ref.
 */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

const HIT = "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-fg/40";

/* --- Card ----------------------------------------------------------------- */

/** A chart with its title, its denominator, and its table twin. */
export function ChartCard({
  title,
  caption,
  table,
  children,
  size = "normal",
}: {
  title: string;
  caption?: string;
  table: ReactNode;
  children: ReactNode;
  size?: "normal" | "large";
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="rounded-xl border border-line bg-surface p-5">
      <figcaption className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className={size === "large" ? "text-lg font-medium text-fg" : "text-sm font-medium text-fg"}>
            {title}
          </h3>
          {caption && <p className="mt-0.5 text-xs text-fg/55">{caption}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs text-fg/60 ring-1 ring-fg/10 hover:text-fg"
        >
          {showTable ? "Chart" : "Table"}
        </button>
      </figcaption>
      {showTable ? table : children}
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-line text-xs text-fg/55">
          {head.map((h) => (
            <th key={h} scope="col" className="py-1.5 pr-3 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-line/60 last:border-0">
            {row.map((cell, j) => (
              <td key={j} className={j === 0 ? "py-1.5 pr-3 text-fg/80" : "py-1.5 pr-3 text-fg tabular-nums"}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --- Bars ----------------------------------------------------------------- */

/**
 * How many respondents chose each option: one series, so one colour, bars
 * from a single baseline with the count at the tip.
 */
export function BarList<K extends string>({
  tallies,
  labels,
  of,
}: {
  tallies: Tally<K>[];
  labels: Record<K, string>;
  /** The denominator the tooltip names: who answered the question. */
  of: number;
}) {
  const tip = useTip();
  const max = Math.max(1, ...tallies.map((t) => t.count));
  return (
    <div data-tip-root className="relative">
      <ul className="space-y-2.5">
        {tallies.map((t) => {
          const pct = (t.count / max) * 88;
          return (
            <li
              key={t.key}
              className="grid gap-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-3"
            >
              <span className="text-sm text-fg/75">{labels[t.key]}</span>
              <div
                {...tip.bind(`${t.count} of ${of}`, labels[t.key])}
                className={`relative h-6 border-l border-line ${HIT}`}
              >
                {t.count > 0 && (
                  <div
                    className="absolute top-1 bottom-1 left-0 rounded-r-[4px] bg-viz-1"
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-xs text-fg/70 tabular-nums"
                  style={{ left: `calc(${pct}% + 6px)` }}
                >
                  {t.count}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {tip.node}
    </div>
  );
}

export function tallyTable<K extends string>(tallies: Tally<K>[], labels: Record<K, string>) {
  return <DataTable head={["Answer", "Respondents"]} rows={tallies.map((t) => [labels[t.key], t.count])} />;
}

/* --- Dots on a scale ------------------------------------------------------ */

/**
 * Every answer to a 1–k item as its own dot, stacked over its value. With a
 * handful of respondents the distribution is the finding; a mean would hide
 * that two people said 1 and two said 7.
 */
export function DotStrip({
  values,
  points,
  low,
  high,
}: {
  values: number[];
  points: number;
  low: string;
  high: string;
}) {
  const tip = useTip();
  const counts = Array.from({ length: points }, (_, i) => values.filter((v) => v === i + 1).length);
  const stack = Math.max(3, ...counts);
  const columns = { gridTemplateColumns: `repeat(${points}, minmax(0, 1fr))` };
  return (
    <div data-tip-root className="relative">
      <div className="grid" style={columns}>
        {counts.map((count, i) => (
          <div
            key={i}
            {...tip.bind(`${count} ${count === 1 ? "answer" : "answers"}`, `${i + 1} on the 1–${points} scale`)}
            className={`flex flex-col-reverse items-center gap-[2px] border-b border-line pb-1 ${HIT}`}
            style={{ height: stack * 16 + 8 }}
          >
            {Array.from({ length: count }, (_, j) => (
              <span key={j} className="size-3.5 shrink-0 rounded-full bg-viz-1 ring-2 ring-surface" />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 grid text-center text-xs text-fg/55 tabular-nums" style={columns}>
        {counts.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="mt-1 flex justify-between gap-4 text-xs text-fg/50">
        <span>{low}</span>
        <span className="text-right">{high}</span>
      </div>
      {tip.node}
    </div>
  );
}

export function scaleTable(values: number[], points: number) {
  return (
    <DataTable
      head={["Value", "Answers"]}
      rows={Array.from({ length: points }, (_, i) => [i + 1, values.filter((v) => v === i + 1).length])}
    />
  );
}

/* --- The hand-off line ---------------------------------------------------- */

const HAND_OFF_ORDER: HandOffAnswer[] = ["myself", "check_later", "gladly"];

const SEGMENT: Record<HandOffAnswer, string> = {
  myself: "bg-viz-2 text-white",
  check_later: "bg-viz-neutral text-fg",
  gladly: "bg-viz-1 text-white",
};

/** The width a count label needs inside a segment before it is dropped to the tooltip. */
const MIN_LABEL_PX = 20;

/**
 * Would you hand this over: a diverging stacked bar per task, centred on the
 * neutral answer. Keep it (orange) runs left, hand it over (blue) runs right,
 * "only if I can check it later" sits across the centre line. The rows come
 * sorted from most handed over to most kept, so where they cross the centre
 * is the line between holding and thinking.
 */
export function HandOffChart({
  rows,
  taskLabels,
  answerLabels,
}: {
  rows: HandOffRow[];
  taskLabels: Record<HandOffTask, string>;
  answerLabels: Record<HandOffAnswer, string>;
}) {
  const tip = useTip();
  const [trackRef, trackWidth] = useWidth<HTMLDivElement>();
  return (
    <div data-tip-root className="relative">
      <Legend
        items={HAND_OFF_ORDER.map((answer) => ({ label: answerLabels[answer], swatch: SEGMENT[answer] }))}
      />
      <ul className="mt-4 space-y-3">
        {rows.map((row, index) => {
          // Half the track is 100% of the answers, so a unanimous row reaches an edge.
          const unit = row.answered ? 50 / row.answered : 0;
          const left = 50 - (row.counts.myself + row.counts.check_later / 2) * unit;
          const present = HAND_OFF_ORDER.filter((answer) => row.counts[answer] > 0);
          return (
            <li
              key={row.task}
              className="grid gap-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-3"
            >
              <span className="text-sm text-fg/75">
                {taskLabels[row.task]}
                <span className="ml-1.5 text-xs text-fg/45 tabular-nums">n={row.answered}</span>
              </span>
              <div ref={index === 0 ? trackRef : undefined} className="relative h-7">
                <div className="absolute -top-1 -bottom-1 left-1/2 w-px bg-line" aria-hidden />
                <div
                  className="absolute inset-y-1 flex gap-[2px]"
                  style={{ left: `${left}%`, width: `${row.answered * unit}%` }}
                >
                  {present.map((answer, i) => {
                    const count = row.counts[answer];
                    const px = ((count * unit) / 100) * trackWidth;
                    return (
                      <div
                        key={answer}
                        {...tip.bind(`${count} of ${row.answered}`, `${answerLabels[answer]} — ${taskLabels[row.task]}`)}
                        className={[
                          "grid min-w-0 place-items-center text-xs font-semibold tabular-nums hover:brightness-110",
                          SEGMENT[answer],
                          i === 0 ? "rounded-l-[4px]" : "",
                          i === present.length - 1 ? "rounded-r-[4px]" : "",
                          HIT,
                        ].join(" ")}
                        style={{ flex: `${count} 1 0` }}
                      >
                        {px >= MIN_LABEL_PX ? count : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 grid text-xs text-fg/50 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-3">
        <span className="hidden sm:block" />
        <div className="flex justify-between">
          <span>← keep it</span>
          <span>hand it over →</span>
        </div>
      </div>
      {tip.node}
    </div>
  );
}

export function handOffTable(
  rows: HandOffRow[],
  taskLabels: Record<HandOffTask, string>,
  answerLabels: Record<HandOffAnswer, string>,
) {
  return (
    <DataTable
      head={["Task", answerLabels.gladly, answerLabels.check_later, answerLabels.myself]}
      rows={rows.map((row) => [taskLabels[row.task], row.counts.gladly, row.counts.check_later, row.counts.myself])}
    />
  );
}

function Legend({ items }: { items: { label: string; swatch: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg/70">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-[3px] ${item.swatch}`} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* --- Figures -------------------------------------------------------------- */

export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-fg/55">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-fg">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-fg/50">{detail}</p>}
    </div>
  );
}
