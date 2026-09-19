import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { appendDraftVersion, loadSessionDrafts, recordDraft } from "@voicemural/db/drafts";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { draftHandle } from "@voicemural/talkback";
import { MAX_DRAFT_CHARS, MAX_DRAFT_TITLE_CHARS } from "@/lib/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store a draft the agent produced for the person to keep.
 *
 * The third thing the container writes, after `agent_turn` and nothing else,
 * and it is deliberately NOT that route: a draft was never spoken, so it has no
 * spoken/generated split, no barge-in and no latency — and above all the echo
 * filter must never see it. `withoutEcho` deletes transcript lines that match
 * what the agent said aloud; a draft that only ever existed on screen cannot
 * have been echoed, and filing it as a turn would teach the filter to delete
 * the participant's own words whenever they resembled a draft they asked for.
 *
 * Ticket-authorised like the other two container routes — the Python side has
 * no Better Auth session — and ownership is re-resolved against
 * `capture_session.userId` rather than trusted from the payload.
 *
 * ## `revises`: the same draft again, not a second one
 *
 * The turn context shows the agent the drafts it has written on this drive,
 * each with a short handle (`draft-context.ts`). When it rewrites one it sends
 * that handle back, and this route turns the write into the next VERSION of
 * that draft rather than a new row — which is the whole difference between
 * "make it shorter" leaving the person with one card or with two.
 *
 * IT FAILS OPEN TO A NEW DRAFT. A handle that matches nothing, or matches more
 * than one draft, writes a new draft instead of guessing which one was meant.
 * That is the same stance `fold.ts` takes when a `revise_block` names a block
 * it cannot find: keep the content, lose the link. Losing the link costs a
 * version number; guessing wrong overwrites text the person may have spent the
 * drive on.
 *
 * ## Both deploy orders work
 *
 * A container older than this route never sends `revises` and gets the old
 * behaviour. A web app older than the container ignores the field, because
 * `revises` is not in its `Body` and Zod drops unknown keys — again the old
 * behaviour. Neither half has to be deployed first.
 */

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  startOffsetMs: z.number().int().min(0),
  title: z.string().default(""),
  text: z.string().min(1),
  respondingToText: z.string().optional(),
  /**
   * The handle of the draft this replaces, from the tag's `revises`.
   *
   * Capped rather than shaped: the handle is six hex characters today, and a
   * length bound is all that is needed to keep a runaway model's attribute out
   * of a query. Anything that does not resolve becomes a new draft anyway.
   */
  revises: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, seq, startOffsetMs, title, text, respondingToText, revises } = parsed.data;

  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);

  if (rows[0]?.userId !== payload.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Truncated, not rejected: this is model output, and a clipped draft is still
  // worth having where losing it entirely to a length check is not. The
  // person's own route makes the opposite trade — see `@/lib/drafts`.
  const clippedTitle = title.slice(0, MAX_DRAFT_TITLE_CHARS);
  const clippedText = text.slice(0, MAX_DRAFT_CHARS);

  const revised = revises ? await resolveHandle(payload.captureSessionId, revises) : null;

  if (revised) {
    const result = await appendDraftVersion({
      draftId: revised,
      userId: payload.userId,
      author: "agent",
      content: { title: clippedTitle, text: clippedText },
      // No `baseVersionId`. The container has no page open and its rewrite is
      // aimed at whatever is current — if the person edited the draft while the
      // model was generating, the rewrite is still the newer intent.
      respondingToText,
    });

    if (result.status === "created" || result.status === "unchanged") {
      const version = result.status === "created" ? result.version : result.head;
      return NextResponse.json(
        { ok: true, draftId: revised, version: version.version, revised: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // `not_found` here means the lineage went away between the two queries.
    // Fall through and write a new draft rather than dropping the text.
  }

  const created = await recordDraft({
    captureSessionId: payload.captureSessionId,
    seq,
    startOffsetMs,
    title: clippedTitle,
    text: clippedText,
    respondingToText,
  });

  return NextResponse.json(
    // `draftId` is null when `(session, seq)` was already taken — a retry, not
    // a failure. The container does not read the body, so this is for logs and
    // for anything that calls this route by hand.
    { ok: true, draftId: created?.draftId ?? null, version: created ? "v1.0" : null, revised: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Which of this drive's drafts a handle names, or null.
 *
 * Compared over the drive's own drafts rather than looked up by a stored
 * column, because the handle is DERIVED (`draftHandle`) and storing it would be
 * a second source of truth for something a uuid already determines. A drive
 * produces a handful of drafts, so this is one indexed read and a scan of a few
 * rows.
 *
 * Exactly one match, or nothing. Two drafts sharing a six-character prefix is
 * vanishingly unlikely, but "vanishingly unlikely" is not a reason to pick one
 * of them and overwrite it.
 */
async function resolveHandle(
  captureSessionId: string,
  revises: string,
): Promise<string | null> {
  // Normalised the same way `draftHandle` renders: lower case, no separators.
  // A model that writes `3F9A-2C` or `#3f9a2c` meant the handle it was shown.
  const wanted = revises.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!wanted) return null;

  const drafts = await loadSessionDrafts(captureSessionId).catch(() => []);
  const matches = drafts.filter((d) => draftHandle(d.id) === wanted);
  return matches.length === 1 ? matches[0]!.id : null;
}
