import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { conversationChain } from "@voicemural/db/conversation";
import { currentUser } from "@/lib/session";
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
  // Continue from a past conversation's page: the drive it picks up, if it is
  // theirs. Anything else is an ordinary start.
  const from = (await searchParams).continue;
  const chain = from && z.uuid().safeParse(from).success ? await conversationChain(user.id, from) : [];
  const last = chain.at(-1);
  const [meta] = last
    ? await getDb()
        .select({ title: captureSession.title, startedAt: captureSession.startedAt })
        .from(captureSession)
        .where(eq(captureSession.id, last))
        .limit(1)
    : [];
  // No dock here: Record and Stop are in the screen's own bar (`recorder-client.tsx`).
  return (
    <RecorderClient
      continueFrom={
        last && meta
          ? {
              id: last,
              title: meta.title ?? meta.startedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
            }
          : null
      }
    />
  );
}
