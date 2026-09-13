import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

export default async function RecordPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  return (
    <>
      <RecorderClient />
      {/* The dock is here so a drive can be left without being stopped — that
          is the whole reason capture was hoisted above the router. It renders
          its navigation only on this route; the transport is the big button. */}
      <AppDock />
    </>
  );
}
