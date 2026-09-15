import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps } from "@voicemural/db/workspace";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { boardEditFromToolCall } from "@voicemural/talkback";
import { planBoardEdit, type PlannedCard } from "@voicemural/workspace";
import { applyBoardEdit } from "@/lib/board/apply-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The talk-back agent's hands on the board: one tool call, carried out.
 *
 * The container registers the tools `/api/realtime/session` gave it and posts
 * every call here verbatim — name and arguments as the model wrote them. What
 * a call MEANS is decided here, in TypeScript, by the same planner the board
 * page uses (`planBoardEdit`), so a spoken "drop that" and a drag write the
 * same row, told apart only by `via: "agent"`. Its ops carry the drive they
 * happened in, which acceptance is counted from.
 *
 * THE RESPONSE IS READ BY THE MODEL. It comes back as the tool's result and
 * the agent speaks from it, so it says plainly what changed or why nothing
 * did — including the case where the task is already where they want it. A
 * failure is still HTTP 200 with `ok: false`: an error the model can read is
 * one it can report aloud, where a bare 4xx would reach it as nothing at all.
 * Only the request itself being wrong (no ticket, bad body) is a 4xx.
 *
 * Ticket-authorised and ownership re-resolved, exactly as `/agent-turn` is. And
 * refused while the person's board is off — the tools are not offered then,
 * but a container mid-drive when the board was switched off must not write.
 */

const Body = z.object({
  ticket: z.string().min(1),
  /** The container's idempotency key for this call; becomes the row id. */
  opId: z.uuid(),
  tool: z.string().min(1).max(40),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

function said(card: PlannedCard) {
  return { task: card.text, column: card.state, topic: card.topicTitle, card: card.handle };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyTicket(parsed.data.ticket);
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

  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!(await boardEnabledAt(payload.userId))) {
    return NextResponse.json({ ok: false, error: "They have no task board yet. Nothing was changed." }, noStore);
  }

  const call = boardEditFromToolCall(parsed.data.tool, parsed.data.arguments);
  if ("error" in call) {
    return NextResponse.json({ ok: false, error: `${call.error}. Nothing was changed.` }, noStore);
  }

  const ops = await loadOps(payload.userId);
  const plan = planBoardEdit(ops, call.edit, {
    via: "agent",
    opId: parsed.data.opId,
    target: call.target,
  });

  switch (plan.status) {
    case "not_found":
    case "ambiguous":
    case "not_a_task":
    case "invalid":
      return NextResponse.json({ ok: false, error: `${plan.reason}. Nothing was changed.` }, noStore);
    case "unchanged":
      return NextResponse.json(
        { ok: true, changed: false, note: "It was already like that; nothing changed.", ...said(plan.card) },
        noStore,
      );
    case "exists":
      return NextResponse.json(
        { ok: true, changed: false, note: "That task is already on the board; nothing was added.", ...said(plan.card) },
        noStore,
      );
  }

  await applyBoardEdit({
    userId: payload.userId,
    ops,
    plan,
    by: "agent",
    captureSessionId: payload.captureSessionId,
  });

  return NextResponse.json({ ok: true, changed: true, ...said(plan.card) }, noStore);
}
