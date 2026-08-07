import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { RecorderClient } from "./recorder-client";

// Reads the session cookie, so it can never be statically generated.
export const dynamic = "force-dynamic";

export default async function RecordPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  return <RecorderClient />;
}
