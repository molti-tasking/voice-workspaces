import { NextResponse } from "next/server";
import { and, captureSession, eq, getDb, isNull } from "@voicemural/db";
import { createPostHogServerClient, postHogSessionProperties } from "@/lib/posthog-server";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Close a capture session.
 *
 * Best-effort: a drive usually ends by arriving somewhere, not by deciding to
 * stop, so this call is often never made. The worker's sweep closes sessions
 * that have gone quiet, and `on-session-end-summarise` fires from there. Never
 * make correctness depend on this endpoint being reached.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { id } = await params;

  const updated = await getDb()
    .update(captureSession)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(captureSession.id, id),
        eq(captureSession.userId, userId),
        // Do not move endedAt if the sweep already closed it.
        isNull(captureSession.endedAt),
      ),
    )
    .returning({ id: captureSession.id });

  if (updated.length > 0) {
    const posthog = createPostHogServerClient();
    if (posthog) {
      posthog.capture({
        distinctId: userId,
        event: "capture_session_closed",
        properties: postHogSessionProperties(req),
      });
      await posthog.shutdown();
    }
  }

  return NextResponse.json({ id, closed: updated.length > 0 });
}
