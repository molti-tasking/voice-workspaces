import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { designPlan, listDesigns, listSessions, type SessionWithBlocks } from "@voicemural/db/study-session";
import { SESSION_HOLD_MS, SESSION_TASK_IDS, SESSION_VIEWS, cellCount, cellFor } from "@voicemural/shared";
import { sessionTaskFor } from "@voicemural/talkback/study-task";
import { currentUser } from "@/lib/session";
import { isResearcher } from "@/lib/study/researchers";
import { studyBaseUrl } from "@/lib/study/session-view";
import { ResearcherStudy, type CellRow, type DesignRow, type SessionRow } from "./researcher-study";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // The root layout's template appends " — Souffleur".
  title: "Display study",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** How far a session got, in the words `pnpm study:session list` uses. */
function stateOf({ session, blocks }: SessionWithBlocks): SessionRow["state"] {
  if (session.completedAt) return "complete";
  if (blocks.length > 0 && blocks.every((b) => b.answeredAt)) return "answered";
  if (blocks.some((b) => b.finishedAt)) return "talked";
  if (session.consentedAt) return "consented";
  if (session.userId) return "claimed";
  return "not opened";
}

/**
 * The display study, for the researchers: its setups — which views each
 * compares, over which tasks, and the one that is running — the sessions
 * filed under one of them, invites and tests, and the data as downloads.
 * What `pnpm study:session` does in the worker's container, from a browser.
 *
 * A 404 for everyone else, signed in or not, rather than a "not allowed":
 * nothing about this page should confirm it exists. Who counts as a
 * researcher is `RESEARCHER_USER_IDS` (see `@/lib/study/researchers`).
 */
export default async function ResearcherPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await currentUser();
  if (!isResearcher(user?.id)) notFound();

  const params = await searchParams;
  const wanted = Array.isArray(params.design) ? params.design[0] : params.design;
  const designs = await listDesigns();
  const selected =
    designs.find((d) => d.design.name === wanted) ??
    designs.find((d) => d.design.status === "active") ??
    designs[0] ??
    null;

  const rows: DesignRow[] = designs.map(({ design, sessions, completed, tests }) => {
    const plan = designPlan(design);
    return {
      name: design.name,
      status: design.status,
      views: [...plan.views],
      tasks: [...plan.tasks],
      cells: cellCount(plan),
      completionCode: design.completionCode,
      note: design.note,
      createdAt: design.createdAt.toISOString(),
      sessions,
      completed,
      tests,
    };
  });

  let cells: CellRow[] = [];
  let sessions: SessionRow[] = [];
  if (selected) {
    const plan = designPlan(selected.design);
    const n = cellCount(plan);
    const all = await listSessions({ design: selected.design.name, tests: true });
    const since = new Date().getTime() - SESSION_HOLD_MS;
    cells = Array.from({ length: n }, (_, index) => {
      const { display, task } = cellFor(plan, index);
      const mine = all.filter(({ session }) => !session.test && session.orderIndex % n === index);
      return {
        index,
        display,
        task,
        completed: mine.filter(({ session }) => session.completedAt).length,
        held: mine.filter(
          ({ session }) => session.completedAt || (session.consentedAt ?? session.createdAt).getTime() > since,
        ).length,
      };
    });
    sessions = all
      .map((state) => {
        const { session, blocks } = state;
        return {
          ref: session.ref,
          source: session.source,
          test: session.test,
          cell: session.orderIndex,
          display: blocks[0]?.display ?? null,
          task: blocks[0]?.task ?? null,
          state: stateOf(state),
          restarts: blocks.reduce((k, b) => k + Math.max(0, b.attempts - 1), 0),
          prolificPid: session.prolificPid,
          // Only an invite nobody has opened yet is worth sending again.
          inviteCode: session.userId === null ? session.inviteCode : null,
          createdAt: session.createdAt.toISOString(),
          consentedAt: iso(session.consentedAt),
          completedAt: iso(session.completedAt),
        };
      })
      .reverse();
  }

  return (
    <ResearcherStudy
      designs={rows}
      selected={selected?.design.name ?? null}
      cells={cells}
      sessions={sessions}
      base={studyBaseUrl()}
      views={[...SESSION_VIEWS]}
      tasks={SESSION_TASK_IDS.map((id) => ({ id, title: sessionTaskFor(id)!.title }))}
    />
  );
}
