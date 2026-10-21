import { NextResponse } from "next/server";
import {
  armBlock,
  blockLinked,
  finishBlock,
  saveBlockAnswers,
  saveFinal,
  saveMoment,
} from "@voicemural/db/study-session";
import { SessionStep } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The session page's steps after consent, for the account's own session
 * (`SessionStep` in @voicemural/shared):
 *
 * - `arm`: the next drive is this block's (`/api/capture-sessions` claims it).
 * - `linked`: whether the drive that started is the block's, so the page
 *   never carries on with a conversation the server does not count.
 * - `moment`: a prompt, the game, the probe or the resumption, on the
 *   drive's clock. A duplicate is fine: the first one stands.
 * - `finished`, `answers`, `final`: each first-one-stands.
 *
 * 409 with a reason when a step comes out of turn; the page treats that as
 * "reload and pick up where the server says".
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = SessionStep.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  const step = parsed.data;

  switch (step.step) {
    case "arm": {
      const result = await armBlock(userId, step.position);
      return result === "armed"
        ? NextResponse.json({ ok: true }, { headers })
        : NextResponse.json({ error: result }, { status: 409, headers });
    }
    case "linked":
      return NextResponse.json(
        { linked: await blockLinked(userId, step.position, step.captureSessionId) },
        { headers },
      );
    case "moment":
      return (await saveMoment(userId, step.position, step.moment)) === "no_drive"
        ? NextResponse.json({ error: "no_conversation" }, { status: 409, headers })
        : NextResponse.json({ ok: true }, { headers });
    case "finished":
      return (await finishBlock(userId, step.position))
        ? NextResponse.json({ ok: true }, { headers })
        : NextResponse.json({ error: "no_conversation" }, { status: 409, headers });
    case "answers": {
      const result = await saveBlockAnswers(userId, step.position, step.answers);
      return result === "saved"
        ? NextResponse.json({ ok: true }, { headers })
        : NextResponse.json({ error: result }, { status: 409, headers });
    }
    case "final": {
      const result = await saveFinal(userId, step.final);
      return result === "saved"
        ? NextResponse.json({ ok: true }, { headers })
        : NextResponse.json({ error: result }, { status: 409, headers });
    }
  }
}
