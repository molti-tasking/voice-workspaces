import { NextResponse } from "next/server";
import { checkLiteLLM, type AiHealth } from "@voicemural/llm";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the AI proxy (LiteLLM) can be used right now, for the recorder's
 * status (`useAiHealth`): ok, or why not — moved, key refused, an error, no
 * answer — so an outage explains itself on the screen.
 *
 * NOT the liveness probe (`/api/health`): the app is alive without the AI, and
 * Coolify must not restart it because a proxy elsewhere is down.
 *
 * Signed-in callers only, and one real check per `CACHE_MS` whatever the
 * number of open tabs.
 */
const CACHE_MS = 20_000;

let cached: { at: number; health: AiHealth } | null = null;
let inFlight: Promise<AiHealth> | null = null;

export async function GET(req: Request) {
  if (!(await currentUserId(req))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    inFlight ??= checkLiteLLM().finally(() => {
      inFlight = null;
    });
    cached = { at: now, health: await inFlight };
  }
  return NextResponse.json(cached.health, { headers: { "Cache-Control": "no-store" } });
}
