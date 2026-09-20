import { NextResponse } from "next/server";
import { getDb, studyEvent } from "@voicemural/db";
import { StudyEventCreate } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Everything days 2–6 of the study are allowed to record: that something was
 * opened.
 *
 * WHY IT EXISTS AT ALL. The offloading question is whether items the person
 * hands to the board come back to them. Dictations and edits already leave
 * `workspace_op` rows, so the one behaviour with no trace anywhere is
 * *looking*: a card someone re-read every morning and never edited is
 * indistinguishable, in the ledger, from one nobody ever saw again — and
 * "never revisited" is half the definition of a lost item.
 *
 * KIND AND TIMESTAMP, NOTHING ELSE. No text, no titles, no paths, no referrer.
 * `cardId` is the root of a revision chain, which is an id the export already
 * carries. The whole table crosses the privacy boundary unchanged.
 *
 * Fire-and-forget from the client: a failure here must never interrupt someone
 * reading their own board, so the response says nothing worth branching on.
 */

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = StudyEventCreate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await getDb()
    .insert(studyEvent)
    .values({
      userId,
      kind: parsed.data.kind,
      cardId: parsed.data.cardId ?? null,
    });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
