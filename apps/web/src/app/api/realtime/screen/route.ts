import { NextResponse } from "next/server";
import { z } from "zod";
import { recordScreen } from "@voicemural/db/display";
import { SCREENS } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({
  captureSessionId: z.uuid(),
  screen: z.enum(SCREENS),
});

/**
 * The browser saying which screen is open during a drive.
 *
 * Session-authorised, unlike the container's routes: it is the person's own
 * browser, and ownership of the drive is checked in `recordScreen`. Only a
 * coarse name from `SCREENS` is accepted — never a URL, which could carry a
 * query the study has no business keeping. `/api/realtime/context` reads the
 * latest back for the agent. See `capture_screen`.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const ok = await recordScreen({ ...parsed.data, userId });
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
