"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ConversationDisplay, SessionTaskId } from "@voicemural/shared";
import { CopyButton } from "@/components/copy-button";
import type { ResearcherAction } from "@/lib/study/researcher-actions";
import { VIEW_LABELS } from "../record/view-switch";

/**
 * The researchers' page for the display study (`page.tsx` reads it all, this
 * draws it and sends the actions to `/api/researcher/study`, then reads the
 * page again). Nothing here is cached or kept in the browser.
 *
 * `ph-no-capture` throughout: the sessions table carries Prolific IDs.
 */

export interface DesignRow {
  name: string;
  status: "draft" | "active" | "closed";
  views: ConversationDisplay[];
  tasks: SessionTaskId[];
  cells: number;
  completionCode: string | null;
  note: string | null;
  createdAt: string;
  sessions: number;
  completed: number;
  tests: number;
}

export interface CellRow {
  index: number;
  display: ConversationDisplay;
  task: SessionTaskId;
  completed: number;
  /** Complete, or begun within the last three hours: what the next session's cell is chosen by. */
  held: number;
}

export interface SessionRow {
  ref: string;
  source: "invite" | "prolific";
  test: boolean;
  cell: number;
  display: string | null;
  task: string | null;
  state: "complete" | "answered" | "talked" | "consented" | "claimed" | "not opened";
  restarts: number;
  prolificPid: string | null;
  inviteCode: string | null;
  createdAt: string;
  consentedAt: string | null;
  completedAt: string | null;
}

const REFUSALS: Record<string, string> = {
  taken: "A setup has that name already.",
  has_sessions: "It has sessions. Delete its tests first, or close it instead.",
  unknown: "That setup is not there any more. Reload the page.",
  not_found: "You are not signed in as a researcher.",
};

/** Send one action; on success, read the page again. The error to show, or null. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (action: ResearcherAction): Promise<{ error: string | null; body: Record<string, unknown> }> => {
    setBusy(true);
    const res = await fetch("/api/researcher/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    setBusy(false);
    if (!res?.ok) {
      const reason = typeof body.error === "string" ? body.error : "network";
      const issues = Array.isArray(body.issues) ? `: ${body.issues.join("; ")}` : "";
      return { error: REFUSALS[reason] ?? (reason === "network" ? "Could not reach the server." : `${reason}${issues}`), body };
    }
    router.refresh();
    return { error: null, body };
  };
  return { busy, run };
}

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";

export function ResearcherStudy({
  designs,
  selected,
  cells,
  sessions,
  base,
  views,
  tasks,
}: {
  designs: DesignRow[];
  selected: string | null;
  cells: CellRow[];
  sessions: SessionRow[];
  base: string;
  views: ConversationDisplay[];
  tasks: { id: SessionTaskId; title: string }[];
}) {
  const active = designs.find((d) => d.status === "active") ?? null;
  const current = designs.find((d) => d.name === selected) ?? null;
  const taskTitle = (id: string | null) => tasks.find((t) => t.id === id)?.title ?? id ?? "—";
  const prolificLink = `${base}/study/session?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`;

  return (
    <main className="ph-no-capture mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-10 pb-24 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-fg/55">For the researchers</p>
        <h1 className="text-3xl font-semibold tracking-tight">Display study</h1>
        <p className="max-w-2xl text-fg/70">
          Which views a session compares is its setup&apos;s. Prolific&apos;s link and new invites go to the active one;
          a setup cannot change once it has a session, so comparing other views is a new setup.
        </p>
      </header>

      <Section title="Prolific">
        {active ? (
          <div className="flex flex-col gap-3">
            <p className="text-fg/75">
              The study URL to give Prolific. Participants arrive in <strong>{active.name}</strong>, the active setup, and
              are handed its completion code at the end.
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-fg/[0.05] px-3 py-2">
              <code className="min-w-0 flex-1 text-sm break-all">{prolificLink}</code>
              <CopyButton text={prolificLink} />
            </div>
            {active.completionCode ? (
              <p className="text-sm text-fg/65">
                Completion code <code className="rounded bg-fg/10 px-1.5 py-0.5">{active.completionCode}</code>: in
                Prolific, choose “redirect participants back” with this code.
              </p>
            ) : (
              <Warning>
                The active setup has no completion code, so in production Prolific&apos;s participants are told the study
                is not open. Add the code Prolific gives you below.
              </Warning>
            )}
            <ProlificTest base={base} />
          </div>
        ) : (
          <Warning>No setup is active: Prolific&apos;s participants are told the study is not open.</Warning>
        )}
      </Section>

      <Section title="Setups">
        <ul className="grid gap-3 sm:grid-cols-2">
          {designs.map((d) => (
            <li key={d.name}>
              <Link
                href={`?design=${encodeURIComponent(d.name)}`}
                scroll={false}
                aria-current={d.name === selected ? "page" : undefined}
                className={[
                  "flex h-full flex-col gap-2 rounded-2xl border p-4 transition-colors",
                  d.name === selected ? "border-fg/40 bg-surface" : "border-line hover:border-fg/25",
                ].join(" ")}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{d.name}</span>
                  <StatusBadge status={d.status} />
                </span>
                <span className="text-sm text-fg/70">
                  {d.views.map((v) => VIEW_LABELS[v]).join(", ")} · {d.tasks.map(taskTitle).join(", ")}
                </span>
                <span className="text-sm text-fg/55">
                  {d.sessions} sessions, {d.completed} complete{d.tests ? ` · ${d.tests} tests` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <NewDesign views={views} tasks={tasks} />
      </Section>

      {current && (
        <DesignDetail design={current} cells={cells} sessions={sessions} base={base} taskTitle={taskTitle} />
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      {children}
    </p>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-300">
      {children}
    </p>
  );
}

function StatusBadge({ status }: { status: DesignRow["status"] }) {
  const style =
    status === "active"
      ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300"
      : status === "draft"
        ? "bg-sky-600/15 text-sky-800 dark:text-sky-300"
        : "bg-fg/10 text-fg/60";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}

const button =
  "min-h-10 cursor-pointer rounded-xl border border-line px-3 py-2 text-sm font-medium hover:border-fg/30 disabled:cursor-default disabled:opacity-50";
const primary =
  "min-h-10 cursor-pointer rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-canvas disabled:cursor-default disabled:opacity-50";
const input = "min-h-10 rounded-xl border border-line bg-canvas px-3 py-2 text-sm";

/** A Prolific link with a made-up ID: the whole Prolific path, filed as a test. */
function ProlificTest({ base }: { base: string }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`${button} self-start`}
        onClick={() => setLink(`${base}/study/session?PROLIFIC_PID=test-${crypto.randomUUID().slice(0, 8)}&STUDY_ID=test&SESSION_ID=test`)}
      >
        Make a Prolific test link
      </button>
      {link && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-fg/[0.05] px-3 py-2">
            <code className="min-w-0 flex-1 text-sm break-all">{link}</code>
            <CopyButton text={link} />
          </div>
          <p className="text-sm text-fg/60">
            Open it in a private window: you take part as a fresh guest, in the active setup, filed as a test.
          </p>
        </div>
      )}
    </div>
  );
}

/** Pick some of `options` in an order: a tap adds one to the end, a second tap takes it out. */
function OrderedPicker<T extends string>({
  options,
  picked,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  picked: T[];
  onChange: (next: T[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const at = picked.indexOf(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={at >= 0}
            onClick={() => onChange(at >= 0 ? picked.filter((p) => p !== o.id) : [...picked, o.id])}
            className={[
              "flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
              at >= 0 ? "border-fg/50 bg-surface font-medium" : "border-line text-fg/65 hover:border-fg/30",
            ].join(" ")}
          >
            {at >= 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-fg text-xs text-canvas">{at + 1}</span>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NewDesign({ views, tasks }: { views: ConversationDisplay[]; tasks: { id: SessionTaskId; title: string }[] }) {
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [pickedViews, setPickedViews] = useState<ConversationDisplay[]>([]);
  const [pickedTasks, setPickedTasks] = useState<SessionTaskId[]>([]);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const create = async () => {
    setError(null);
    const { error: refused } = await run({
      action: "create_design",
      design: {
        name: name.trim(),
        views: pickedViews,
        tasks: pickedTasks,
        completionCode: code.trim() || null,
        note: note.trim() || null,
      },
    });
    if (refused) return setError(refused);
    setOpen(false);
    setName("");
    setPickedViews([]);
    setPickedTasks([]);
    setCode("");
    setNote("");
  };

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-2xl border border-line p-4">
      <summary className="cursor-pointer font-medium">New setup</summary>
      <div className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="stack-pilot"
            autoComplete="off"
          />
          <span className="text-xs text-fg/55">Lowercase letters, digits and dashes. Every export calls it this.</span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Views, in order</span>
          <OrderedPicker
            label="Views"
            options={views.map((v) => ({ id: v, label: VIEW_LABELS[v] }))}
            picked={pickedViews}
            onChange={setPickedViews}
          />
          <span className="text-xs text-fg/55">The first is the baseline; the blind judge letters them in this order.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Tasks, in order</span>
          <OrderedPicker
            label="Tasks"
            options={tasks.map((t) => ({ id: t.id, label: t.title }))}
            picked={pickedTasks}
            onChange={setPickedTasks}
          />
        </div>
        <p className="text-sm text-fg/65">
          {pickedViews.length * pickedTasks.length || "No"} cells: every view with every task. Each participant gets one.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Prolific completion code (optional)</span>
            <input className={input} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note (optional)</span>
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <button
          type="button"
          className={`${primary} self-start`}
          disabled={busy || !name.trim() || pickedViews.length === 0 || pickedTasks.length === 0}
          onClick={() => void create()}
        >
          Make it, as a draft
        </button>
      </div>
    </details>
  );
}

function DesignDetail({
  design,
  cells,
  sessions,
  base,
  taskTitle,
}: {
  design: DesignRow;
  cells: CellRow[];
  sessions: SessionRow[];
  base: string;
  taskTitle: (id: string | null) => string;
}) {
  const { busy, run } = useAction();
  const [error, setError] = useState<string | null>(null);
  const act = async (action: ResearcherAction) => {
    setError(null);
    const { error: refused } = await run(action);
    if (refused) setError(refused);
  };
  const tests = sessions.filter((s) => s.test).length;
  const download = (file: string) => `/api/researcher/study/export?design=${encodeURIComponent(design.name)}&file=${file}`;

  return (
    <Section title={`Setup: ${design.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={design.status} />
        <span className="text-sm text-fg/60">made {when(design.createdAt)}</span>
        <span className="flex-1" />
        {design.status !== "active" && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Make ${design.name} the active setup? The one active now closes.`)) {
                void act({ action: "set_status", name: design.name, status: "active" });
              }
            }}
          >
            Make active
          </button>
        )}
        {design.status !== "closed" && (
          <button type="button" className={button} disabled={busy} onClick={() => void act({ action: "set_status", name: design.name, status: "closed" })}>
            Close
          </button>
        )}
        {design.sessions === 0 && design.tests === 0 && (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete the setup ${design.name}?`)) void act({ action: "delete_design", name: design.name });
            }}
          >
            Delete
          </button>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      <Details design={design} />

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Cells</h3>
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="text-fg/55">
              <tr>
                <th className="px-3 py-2 font-medium">Cell</th>
                <th className="px-3 py-2 font-medium">View</th>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Complete</th>
                <th className="px-3 py-2 font-medium">Held now</th>
                <th className="px-3 py-2 font-medium">Walk through</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={c.index} className="border-t border-line">
                  <td className="px-3 py-2">{c.index}</td>
                  <td className="px-3 py-2">{VIEW_LABELS[c.display]}</td>
                  <td className="px-3 py-2">{taskTitle(c.task)}</td>
                  <td className="px-3 py-2">{c.completed}</td>
                  <td className="px-3 py-2">{c.held}</td>
                  <td className="px-3 py-2">
                    <a
                      className="underline underline-offset-2"
                      href={`/study/session?demo=1&design=${encodeURIComponent(design.name)}&order=${c.index}&fast=10`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg/55">
          A new session takes the cell held by the fewest: complete, or begun in the last three hours. Preview runs the
          simulated conversation ten times faster: no microphone, no AI, nothing saved.
        </p>
      </div>

      <Invite design={design} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Sessions</h3>
          <span className="flex-1" />
          {tests > 0 && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete the ${tests} test sessions of ${design.name}, with what they recorded?`)) {
                  void act({ action: "delete_tests", name: design.name });
                }
              }}
            >
              Delete {tests} tests
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-fg/60">None yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="text-fg/55">
                <tr>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Cell</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 font-medium">Made</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.ref} className={`border-t border-line ${s.test ? "text-fg/55" : ""}`}>
                    <td className="px-3 py-2 font-medium">
                      {s.ref}
                      {s.test && <span className="ml-1.5 rounded bg-fg/10 px-1.5 text-xs">test</span>}
                    </td>
                    <td className="px-3 py-2" title={s.prolificPid ?? undefined}>
                      {s.source === "prolific" ? `Prolific ${s.prolificPid ? `${s.prolificPid.slice(0, 6)}…` : ""}` : "invite"}
                    </td>
                    <td className="px-3 py-2">
                      {s.cell} · {s.display ? VIEW_LABELS[s.display as ConversationDisplay] ?? s.display : "—"}, {taskTitle(s.task)}
                    </td>
                    <td className="px-3 py-2">
                      {s.state}
                      {s.restarts > 0 && <span className="text-fg/55"> ({s.restarts} restarted)</span>}
                    </td>
                    <td className="px-3 py-2">{when(s.createdAt)}</td>
                    <td className="px-3 py-2">{when(s.completedAt)}</td>
                    <td className="px-3 py-2">
                      {s.inviteCode && <CopyButton text={`${base}/study/session?code=${s.inviteCode}`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Downloads</h3>
        <p className="text-sm text-fg/65">
          Built fresh, tests left out. Summaries and what they wrote are in them; keep the files with the study&apos;s data.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className={button} href={download("sessions")}>sessions.csv</a>
          <a className={button} href={download("blocks")}>blocks.csv</a>
          <a className={button} href={download("moments")}>moments.csv</a>
          <a className={button} href={download("prolific-key")}>prolific-key.csv</a>
          <a
            className={button}
            href={download("transcripts")}
            onClick={(e) => {
              if (!window.confirm("The transcripts are their words, every line. Download them?")) e.preventDefault();
            }}
          >
            transcripts.jsonl
          </a>
        </div>
        <p className="text-xs text-fg/55">
          prolific-key.csv says which Prolific participant each pseudonym is, for paying them. Keep it apart from the
          analysis files.
        </p>
      </div>
    </Section>
  );
}

/** The completion code and the note: what may change about a setup at any time. */
function Details({ design }: { design: DesignRow }) {
  const { busy, run } = useAction();
  const [code, setCode] = useState(design.completionCode ?? "");
  const [note, setNote] = useState(design.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = code.trim() !== (design.completionCode ?? "") || note.trim() !== (design.note ?? "");

  const save = async () => {
    setError(null);
    setSaved(false);
    const { error: refused } = await run({
      action: "update_details",
      name: design.name,
      completionCode: code.trim() || null,
      note: note.trim() || null,
    });
    if (refused) setError(refused);
    else setSaved(true);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <p className="text-sm text-fg/70">
        {design.views.map((v) => VIEW_LABELS[v]).join(", ")} × {design.tasks.length} tasks · {design.cells} cells
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Prolific completion code</span>
          <input className={input} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Note</span>
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <button type="button" className={button} disabled={busy || !changed} onClick={() => void save()}>
          Save
        </button>
        {saved && !changed && <span className="text-sm text-fg/60">Saved.</span>}
      </div>
    </div>
  );
}

/** An invite link in this setup: in a pinned cell or the least held; a test holds none. */
function Invite({ design }: { design: DesignRow }) {
  const { busy, run } = useAction();
  const [cell, setCell] = useState<string>("auto");
  const [test, setTest] = useState(design.status !== "active");
  const [made, setMade] = useState<{ ref: string; link: string; cell: number; view: string | null; test: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only a test may be made in a closed setup.
  const allowed = test || design.status !== "closed";

  const invite = async () => {
    setError(null);
    const { error: refused, body } = await run({
      action: "invite",
      name: design.name,
      orderIndex: cell === "auto" ? null : Number(cell),
      test,
    });
    if (refused) return setError(refused);
    setMade(body as unknown as NonNullable<typeof made>);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <h3 className="font-medium">Invite link</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm">Cell</span>
          <select className={input} value={cell} onChange={(e) => setCell(e.target.value)}>
            <option value="auto">The least held</option>
            {Array.from({ length: design.cells }, (_, k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={test} onChange={(e) => setTest(e.target.checked)} />
          A test: holds no cell, left out of the exports
        </label>
        <button type="button" className={primary} disabled={busy || !allowed} onClick={() => void invite()}>
          Make the link
        </button>
      </div>
      {!allowed && <p className="text-sm text-fg/60">This setup is closed: only tests can be made in it.</p>}
      {error && <ErrorText>{error}</ErrorText>}
      {made && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-fg/[0.05] px-3 py-2">
            <code className="min-w-0 flex-1 text-sm break-all">{made.link}</code>
            <CopyButton text={made.link} />
          </div>
          <p className="text-sm text-fg/60">
            {made.ref}, cell {made.cell}
            {made.view ? ` (${VIEW_LABELS[made.view as ConversationDisplay] ?? made.view})` : ""}
            {made.test ? ", a test" : ""}. Whoever consents on it first takes part, as a fresh guest.
          </p>
        </div>
      )}
    </div>
  );
}
