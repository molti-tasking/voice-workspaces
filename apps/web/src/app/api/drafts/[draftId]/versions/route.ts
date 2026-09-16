import { NextResponse } from "next/server";
import { z } from "zod";
import { appendDraftVersion } from "@voicemural/db/drafts";
import { MAX_DRAFT_CHARS, MAX_DRAFT_TITLE_CHARS } from "@/lib/drafts";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * The person's half of a draft: edit it, or put an earlier version back.
 *
 * The container writes drafts through `/api/realtime/draft`, which is
 * ticket-authorised because Python has no Better Auth session. This is the
 * other writer and it is an ordinary signed-in route — the person is at a desk
 * with a page open, which is the only place a draft can actually be edited.
 * Both end up in `appendDraftVersion`, which is where the numbering, the lock
 * and the ownership check live; nothing about versions is decided here.
 *
 * OWNERSHIP IS PROVED BY PRESENCE, as on `/api/board/cards/[blockId]`:
 * `appendDraftVersion` joins the lineage to `capture_session` and filters on
 * the user, so a draft id belonging to somebody else is simply `not_found`.
 * There is no separate 403 — telling a stranger that a draft exists but is not
 * theirs is more than they should learn from a URL.
 *
 * A RESTORE IS A WRITE, not a rewind: it appends a copy of the chosen version
 * with the next number and a note of where it came from. So this route has no
 * DELETE and no PUT — the record is append-only (EVALUATION_PLAN.md §4), and
 * every route on it is a POST that adds a row.
 */

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    /** The version they were looking at. A mismatch is a 409, never an overwrite. */
    baseVersionId: z.uuid(),
    // REFUSED rather than truncated, unlike the container's route. A model that
    // runs away is better clipped than lost; a person who pastes a long email
    // and gets the end eaten has been silently damaged by the thing that was
    // supposed to keep their text safe.
    title: z.string().max(MAX_DRAFT_TITLE_CHARS),
    text: z.string().min(1).max(MAX_DRAFT_CHARS),
  }),
  z.object({
    action: z.literal("restore"),
    baseVersionId: z.uuid(),
    /** The version to copy forward. Must belong to this draft. */
    versionId: z.uuid(),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { draftId } = await params;
  // A path segment that is not a uuid can never name a row, so it is a 404
  // rather than a 400: the client did not send a bad BODY, it asked for
  // something that does not exist.
  if (!z.uuid().safeParse(draftId).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const body = parsed.data;
  const result = await appendDraftVersion({
    draftId,
    userId,
    // Every write through this route is the PERSON's, so it takes a minor even
    // when what it restores was the agent's. The number records who made the
    // change, not who originally wrote the words.
    author: "user",
    content:
      body.action === "restore"
        ? { restoreVersionId: body.versionId }
        : { title: body.title, text: body.text },
    baseVersionId: body.baseVersionId,
  });

  switch (result.status) {
    case "created":
      return NextResponse.json({ status: "ok", version: result.version });
    case "unchanged":
      // 200, not 409. Saving text identical to what is already there is a
      // no-op, not a failure — a slow Save tapped twice must not look broken.
      return NextResponse.json({ status: "unchanged", head: result.head });
    case "conflict":
      // The head is in the body so the editor can say what it moved to and set
      // its base to it, WITHOUT discarding what the person typed.
      return NextResponse.json({ error: "conflict", head: result.head }, { status: 409 });
    case "not_found":
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
