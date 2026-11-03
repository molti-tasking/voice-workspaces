import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { latestConversationDrive, loadConversation } from "@voicemural/db/conversation";
import { currentUser } from "@/lib/session";
import type { DriveRecord } from "@/lib/talkback/replay";
import { RecorderClient } from "./recorder-client";

// Reads the session cookie, so it can never be statically generated.
export const dynamic = "force-dynamic";

// robots.txt already asks crawlers not to come here; this is the half that
// still applies when a participant shares the URL and something follows it.
export const metadata: Metadata = {
  title: "Record",
  robots: { index: false, follow: false },
};

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ continue?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/");
  // ONE CONVERSATION THAT KEEPS GROWING (3 Nov 2026): the screen opens on it,
  // and Record carries it on. It is the one a past conversation's Continue
  // named, if it is theirs, and otherwise their latest.
  const from = (await searchParams).continue;
  const named = from && z.uuid().safeParse(from).success ? from : null;
  const at = named ?? (await latestConversationDrive(user.id));
  const drives = at ? await loadConversation(user.id, at) : null;
  // The same records `/api/conversations/[id]` serves for a Continue, so the
  // screen before Record and the drive after it rebuild the same thing.
  const past =
    drives && drives.length > 0
      ? {
          lastDriveId: drives.at(-1)!.id,
          drives: drives.map(
            (d): DriveRecord => ({
              lines: d.lines.map(({ who, startMs, endMs, text }) => ({ who, startMs, endMs, text })),
              visits: d.visits.map(({ ordinal, title, startMs }) => ({ ordinal, title, startMs })),
              subjects: d.subjects,
            }),
          ),
        }
      : null;
  // No dock here: Record and Stop are in the screen's own bar (`recorder-client.tsx`).
  return <RecorderClient past={past} />;
}
