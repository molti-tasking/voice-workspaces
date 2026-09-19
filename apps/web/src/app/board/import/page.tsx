import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boardEnabledAt } from "@voicemural/db/board";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { currentUser } from "@/lib/session";
import { ImportPanel } from "./import-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Import a board",
  robots: { index: false, follow: false },
};

/**
 * Bringing in a board the person already keeps.
 *
 * Nobody starts with nothing in flight. Until the work they are already
 * carrying is on this board, the first drives talk past it — the extractor
 * only ever hears a task that gets SAID, and the agent is shown the board and
 * nothing else, so "how did the William thing go" lands nowhere. An import is
 * how a deployment starts mid-stream instead of at zero.
 *
 * Imported cards enter the ledger under `via: "import"`, and `judge()` does not
 * score them: they are the person's own record of their own work, not a
 * reading of their speech. What speech does to them AFTERWARDS is judged as
 * usual, which is the reason to do this at all — it gets the acceptance
 * question asked on the first drive rather than the tenth.
 *
 * Hidden behind `board_enabled_at` exactly as the board is, so a participant in
 * the before phase cannot reach it.
 */
export default async function ImportBoardPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to import a board.
        </p>
      </main>
    );
  }

  if (!(await boardEnabledAt(user.id))) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 pt-10 pb-40">
      <header className="mb-8">
        <Link href="/board" className="text-sm text-white/40 underline-offset-4 hover:underline">
          ← Board
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Bring in a board you already have</h1>
        <p className="mt-2 max-w-prose text-sm text-white/40">
          Paste a Trello export, a Jira or Trello CSV, a Notion table, or just a list of things you
          mean to do. The columns other tools use are mapped onto these five; anything the reader
          does not recognise becomes a topic rather than a column.
        </p>
      </header>

      <ImportPanel />

      <AppDock />
    </div>
  );
}
