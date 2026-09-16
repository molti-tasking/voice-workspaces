"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  DEFAULT_IMPORT_TOPIC,
  MAX_IMPORT_TASKS,
  TaskState,
  parseBoard,
  type ImportedTask,
  type ParsedBoard,
  type SkippedTask,
} from "@voicemural/workspace";
import { Link } from "@/components/nav-link";

/*
 * The parse runs HERE, in the browser, and that is the point.
 *
 * What someone pastes is a whole export: a Jira CSV carries assignees,
 * reporters, comment counts and whatever else their instance adds; a Notion
 * page carries the rest of the page. Parsing on the server would put all of it
 * on the wire and in a request log for the sake of forty task lines.
 * `parseBoard` is pure — no database, no model call — so it runs where the
 * paste already is, and only the lines the person confirms are sent.
 *
 * Nothing from `@voicemural/db` may be imported here: the database driver in
 * the browser bundle fails `next build`, which is the only check that catches
 * it. `@voicemural/workspace` is pure and already crosses this seam in
 * `board-surface.tsx`.
 */

const STATES = TaskState.options;

/** A parsed task plus what the person did to it in the preview. */
interface Row extends ImportedTask {
  key: string;
  dropped: boolean;
}

type Outcome = {
  imported: number;
  topicsCreated: string[];
  skipped: SkippedTask[];
};

const SKIP_REASONS: Record<SkippedTask["reason"], string> = {
  too_long: "too long for a task",
  over_limit: `past the ${MAX_IMPORT_TASKS}-card limit`,
  archived: "archived where it came from",
  duplicate: "already on the board",
};

export function ImportPanel() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedBoard | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [topic, setTopic] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const keeping = useMemo(() => rows.filter((r) => !r.dropped), [rows]);

  const read = useCallback(() => {
    const result = parseBoard(text);
    setParsed(result);
    setRows(result.tasks.map((task, i) => ({ ...task, key: `${i}`, dropped: false })));
    setOutcome(null);
    setError(null);
  }, [text]);

  const setRow = useCallback((key: string, patch: Partial<Row>) => {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const send = useCallback(() => {
    if (!parsed || keeping.length === 0) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/board/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Minted per submit, so a retry after a dead connection reaches the
            // server as the same import rather than a second copy of the board.
            batchId: crypto.randomUUID(),
            format: parsed.format,
            topic: topic.trim() || undefined,
            tasks: keeping.map((r) => ({ text: r.text, state: r.state, topic: r.topic })),
          }),
        });
        if (!res.ok) {
          setError("Nothing was imported. The board is unchanged.");
          return;
        }
        const body = (await res.json()) as Outcome;
        setOutcome(body);
        setParsed(null);
        setRows([]);
        setText("");
        router.refresh();
      } catch {
        setError("Offline — nothing was imported.");
      }
    });
  }, [keeping, parsed, router, topic]);

  if (outcome) return <Done outcome={outcome} onAgain={() => setOutcome(null)} />;

  return (
    <div className="space-y-6">
      <section>
        <label htmlFor="paste" className="mb-2 block text-sm text-white/60">
          Paste your board or list
        </label>
        <textarea
          id="paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="w-full rounded-xl border border-line bg-ink-soft/40 p-3 font-mono text-sm text-white/80 placeholder:text-white/20 focus:border-white/30 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={read}
            disabled={!text.trim()}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-white/80 hover:border-white/30 disabled:opacity-30"
          >
            Read it
          </button>
          <p className="text-xs text-white/30">
            Nothing is saved until you say so, and the paste itself never leaves this device.
          </p>
        </div>
      </section>

      {parsed && (
        <section>
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">
              {keeping.length} task{keeping.length === 1 ? "" : "s"} to add
            </h2>
            <p className="text-xs text-white/30">read as {FORMAT_NAMES[parsed.format]}</p>
          </header>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-white/40">
              Nothing in that looked like a task. Try a list, one task per line.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {rows.map((row) => (
                  <li
                    key={row.key}
                    className={[
                      "flex flex-wrap items-center gap-3 p-3 text-sm",
                      row.dropped ? "opacity-30" : "",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1 truncate" title={row.text}>
                      {row.text}
                    </span>

                    {row.topic && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-white/40">
                        {row.topic}
                      </span>
                    )}

                    <label className="sr-only" htmlFor={`state-${row.key}`}>
                      Column for {row.text}
                    </label>
                    <select
                      id={`state-${row.key}`}
                      value={row.state}
                      disabled={row.dropped}
                      onChange={(e) => setRow(row.key, { state: e.target.value as ImportedTask["state"] })}
                      className="rounded-full border border-line bg-ink-soft/40 px-2 py-1 text-xs text-white/70"
                    >
                      {STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => setRow(row.key, { dropped: !row.dropped })}
                      className="text-xs text-white/30 underline-offset-4 hover:text-white/60 hover:underline"
                    >
                      {row.dropped ? "keep" : "not a task"}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap items-end gap-4">
                <div>
                  <label htmlFor="topic" className="mb-1 block text-xs text-white/40">
                    Topic for anything that did not name one
                  </label>
                  <input
                    id="topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={80}
                    placeholder={DEFAULT_IMPORT_TOPIC}
                    className="rounded-full border border-line bg-ink-soft/40 px-3 py-1.5 text-sm text-white/80 placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={send}
                  disabled={busy || keeping.length === 0}
                  className="rounded-full border border-white/30 px-4 py-1.5 text-sm hover:border-white/60 disabled:opacity-30"
                >
                  {busy ? "Adding…" : `Add ${keeping.length} to the board`}
                </button>
              </div>
            </>
          )}

          <Skipped skipped={parsed.skipped} />
        </section>
      )}

      {error && (
        <p role="status" className="text-sm text-rose-300/80">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What was refused, and why.
 *
 * Shown rather than dropped silently: an import that quietly loses nine of
 * forty tasks is found out weeks later, when the card someone was waiting for
 * never comes up in a drive.
 */
function Skipped({ skipped }: { skipped: SkippedTask[] }) {
  if (skipped.length === 0) return null;
  return (
    <details className="mt-4 text-xs text-white/40">
      <summary className="cursor-pointer">
        {skipped.length} line{skipped.length === 1 ? "" : "s"} left out
      </summary>
      <ul className="mt-2 space-y-1">
        {skipped.map((s, i) => (
          <li key={`${s.reason}-${i}`} className="truncate">
            <span className="text-white/60">{s.text}</span> — {SKIP_REASONS[s.reason]}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Done({ outcome, onAgain }: { outcome: Outcome; onAgain: () => void }) {
  return (
    <div className="rounded-xl border border-line p-6">
      <p className="font-medium">
        {outcome.imported} card{outcome.imported === 1 ? "" : "s"} added
        {outcome.topicsCreated.length > 0 && ` · ${outcome.topicsCreated.join(", ")}`}
      </p>
      <p className="mt-1 text-sm text-white/40">
        They sit on the board like any other card, and say they came from an import. Speech moves
        them from here: say how one went and it changes column.
      </p>
      <Skipped skipped={outcome.skipped} />
      <div className="mt-4 flex gap-4 text-sm">
        <Link href="/board" className="underline underline-offset-4">
          See the board
        </Link>
        <button
          type="button"
          onClick={onAgain}
          className="text-white/40 underline-offset-4 hover:text-white/70 hover:underline"
        >
          Import another
        </button>
      </div>
    </div>
  );
}

const FORMAT_NAMES: Record<ParsedBoard["format"], string> = {
  "trello-json": "a Trello export",
  table: "a table — Jira, Trello or a spreadsheet",
  outline: "a list",
};

const PLACEHOLDER = `## In progress
- Rewrite the silence gate
- [x] Book the ferry

## Voice paper
- Draft the related work`;
