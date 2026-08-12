import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
  return <RecorderClient />;
}
