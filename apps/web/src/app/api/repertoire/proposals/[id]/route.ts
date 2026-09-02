import { NextResponse } from "next/server";
import { acceptMacroProposal, declineMacroProposal } from "@voicemural/db/repertoire";
import { currentUserId } from "@/lib/session";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({ decision: z.enum(["accept", "decline"]) });

/**
 * Answer a macro proposal.
 *
 * Both answers are writes, and both are recorded. Accepting inserts the
 * capability, its first version and its origin in one transaction; declining
 * marks the proposal declined and keeps it, so the detector never re-offers it
 * and "what they tried to add and failed" stays answerable.
 *
 * Scoped to the signed-in user inside the query rather than checked here: the
 * proposal id is the only thing the client supplies, and a `WHERE user_id`
 * cannot be forgotten the way a guard clause can.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;

  if (parsed.data.decision === "decline") {
    const declined = await declineMacroProposal(userId, id);
    return declined
      ? NextResponse.json({ status: "declined" })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const accepted = await acceptMacroProposal(userId, id);
  return accepted
    ? NextResponse.json({ status: "accepted", ...accepted })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
