import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { conversationChain } from "@voicemural/db/conversation";
import { AppDock } from "@/components/app-dock";
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
  return (
    <>
      <RecorderClient
        continueFrom={
          last && meta
            ? {
                id: last,
                title:
                  meta.title ?? meta.startedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
              }
            : null
        }
      />
      {/* The dock is here so a drive can be left without being stopped — that
          is the whole reason capture was hoisted above the router. It renders
          its navigation only on this route; the transport is the big button. */}
      <AppDock />
    </>
  );
}
