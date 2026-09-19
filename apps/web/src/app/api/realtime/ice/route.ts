import { NextResponse } from "next/server";
import {
  buildIceServers,
  parseIceUrls,
} from "@voicemural/shared/turn-credentials";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How the browser finds a path to the voice container for the audio.
 *
 * WHY THIS IS A ROUTE AND NOT A BUILD-TIME CONSTANT. It used to be
 * `NEXT_PUBLIC_ICE_SERVERS`, inlined into the bundle. That is fine for STUN,
 * which is a bare hostname anyone may use, and impossible for TURN: a relay
 * needs a credential, and a credential in the client bundle is public, never
 * expires, and is an open relay for whoever reads the JavaScript. Minting one
 * per connection needs a server, and this is the smallest one that has the
 * secret.
 *
 * The second reason is operational, and the repository has been bitten by it
 * before: every `NEXT_PUBLIC_` value is baked at BUILD time, so changing ICE
 * configuration meant a rebuild, and a rebuild that was forgotten looked
 * exactly like a network fault. Served from here, TURN can be pointed somewhere
 * else with a restart.
 *
 * `NEXT_PUBLIC_ICE_SERVERS` is still the client's fallback for when this route
 * cannot be reached — see use-pipecat.ts. It is the LAN answer, and it is the
 * right answer there.
 */

/**
 * Authenticated, because this hands out a working relay credential. Not
 * because the relay carries anything secret — it carries the same audio the
 * peer connection would — but because an unauthenticated mint is free
 * bandwidth for anyone who finds the URL.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  /* The SERVER-side variable, deliberately falling back to the public one.
   *
   * A deployment that set only `NEXT_PUBLIC_ICE_SERVERS` — which is every
   * deployment before TURN existed — keeps the STUN server it already had
   * rather than silently losing it and regressing to host candidates. */
  const stunUrls = parseIceUrls(
    process.env.ICE_SERVERS || process.env.NEXT_PUBLIC_ICE_SERVERS,
  ).filter((url) => url.startsWith("stun:") || url.startsWith("stuns:"));

  const ttl = Number(process.env.TURN_TTL_SECONDS) || undefined;

  const { iceServers, turnExpiresAt } = buildIceServers({
    stunUrls,
    turnUrls: parseIceUrls(process.env.TURN_URLS),
    turnSecret: process.env.TURN_SECRET,
    ttlSeconds: ttl,
  });

  return NextResponse.json(
    { iceServers, turnExpiresAt },
    // A bearer credential with a deadline. Nothing between here and the browser
    // has any business keeping a copy.
    { headers: { "Cache-Control": "no-store" } },
  );
}
