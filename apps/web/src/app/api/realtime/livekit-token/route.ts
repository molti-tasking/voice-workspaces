import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A LiveKit join token for one drive.
 *
 * Replaces the hand-rolled HMAC ticket: LiveKit's tokens are JWTs the media
 * server verifies itself, so the agent never has to re-authenticate a socket.
 *
 * ONE ROOM PER DRIVE, named for the capture session. That is how the agent
 * knows which drive it joined without the client telling it — the client cannot
 * lie about which transcript it gets read back.
 */

const Body = z.object({ captureSessionId: z.uuid() });

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { captureSessionId } = parsed.data;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    // Talk-back simply unavailable, which capture does not care about.
    return NextResponse.json({ error: "talkback_unavailable" }, { status: 503 });
  }

  // Ownership checked here, where a database connection is already at hand. A
  // session row that does not exist yet is normal: the recorder generates the
  // id client-side and buffers before the network confirms anything.
  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);

  const owner = rows[0]?.userId;
  if (owner && owner !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    // Short: it authorises joining, and a drive that reconnects mints another.
    ttl: "10m",
  });
  token.addGrant({
    room: `drive-${captureSessionId}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  return NextResponse.json(
    { token: await token.toJwt(), url, room: `drive-${captureSessionId}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
