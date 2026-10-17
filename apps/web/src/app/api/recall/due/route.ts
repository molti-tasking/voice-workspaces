import { NextResponse } from "next/server";
import { countDueProbes, scheduleMissedRecallProbes } from "@voicemural/db/recall";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many recall questions are due for them, for the card on the screens
 * that are not recording. A count and nothing else; the questions themselves
 * are on `/recall`. Schedules any recent drive Stop never reached first.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  await scheduleMissedRecallProbes(userId);
  const due = await countDueProbes(userId);
  return NextResponse.json({ due }, { headers: { "Cache-Control": "no-store" } });
}
