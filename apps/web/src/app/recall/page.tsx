import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadDueProbes, scheduleMissedRecallProbes } from "@voicemural/db/recall";
import { currentUser } from "@/lib/session";
import { RecallFlow } from "./recall-flow";

export const dynamic = "force-dynamic";

/**
 * The recall probe: a couple of days after a drive, a few of its subjects,
 * asked back.
 *
 * For each: the subject's name only, and how well they remember where they
 * landed (1-7). Then they say it or type it TO THEMSELVES — nothing they type
 * leaves the page. Then their own words on it, from the drive, and how close
 * they were (1-7), and whose idea it mostly was. The first rating against the
 * second is the study's measure of how well they know what they know; the
 * last checks whether the recorder's "whose words" bar means anything.
 *
 * Numbers and an enum are kept (`recall_probe`); their words never are. The
 * page they reach it from is any screen that is not recording
 * (`RecallCard`); there is no push.
 */

export const metadata: Metadata = {
  title: "Recall",
  robots: { index: false, follow: false },
};

export default async function RecallPage() {
  const user = await currentUser();
  if (!user) notFound();
  await scheduleMissedRecallProbes(user.id);
  const due = await loadDueProbes(user.id);

  return (
    <div className="mx-auto max-w-2xl vm-page-top px-6 pb-40">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">
          From a past drive
        </p>
        <h1 className="text-2xl font-semibold">What do you remember?</h1>
        <p className="mt-2 leading-relaxed text-fg/60">
          A few things you talked about a couple of days ago. For each, say how
          well you remember it, think it through, then look. Only your taps are
          kept: nothing you say or type here is saved.
        </p>
      </header>
      {due.length === 0 ? (
        <p className="rounded-2xl border border-line px-4 py-3 text-fg/60">
          Nothing to look back on right now.
        </p>
      ) : (
        <RecallFlow
          probes={due.map((p) => ({
            id: p.id,
            title: p.title,
            driveStartedAt: p.driveStartedAt.toISOString(),
            rated: p.confidence !== null,
          }))}
        />
      )}
    </div>
  );
}
