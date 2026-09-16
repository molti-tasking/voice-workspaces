import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import {
  asSttLanguage,
  searchResultForModel,
  searxngRequest,
  webSearchFromToolCall,
} from "@voicemural/talkback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The talk-back agent's web search: one `search_web` call, run against
 * SearXNG.
 *
 * The container posts the call's arguments here verbatim, as it does board
 * calls to `/board`. The instance's address — and any credentials in it — stay
 * in this app's environment, and what a result looks like to the model is
 * decided in TypeScript (`searchResultForModel`).
 *
 * THE RESPONSE IS READ BY THE MODEL, so a failure is HTTP 200 with `ok: false`
 * and a sentence it can say aloud. Only a malformed request or a bad ticket is
 * a 4xx.
 *
 * Budgeted to answer inside the container's own timeout: a driver is sitting
 * through a cue while this runs, and a search that has not come back in a few
 * seconds is better reported as failed than waited for.
 *
 * The query is never logged. It is the participant's question.
 */

const SEARCH_TIMEOUT_MS = 5_000;

const Body = z.object({
  ticket: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

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
    .select({ userId: captureSession.userId, sttLanguage: captureSession.sttLanguage })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);
  if (rows[0]?.userId !== payload.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const noStore = { headers: { "Cache-Control": "no-store" } };

  const base = process.env.SEARXNG_URL;
  if (!base) {
    return NextResponse.json({ ok: false, error: "Web search is not set up." }, noStore);
  }

  const call = webSearchFromToolCall(parsed.data.arguments);
  if ("error" in call) {
    return NextResponse.json({ ok: false, error: `${call.error}.` }, noStore);
  }

  // The drive's pinned transcription language, when there is one, is the best
  // guess at the language worth searching in. Auto-detect leaves it to SearXNG.
  const { url, headers } = searxngRequest(base, call.query, asSttLanguage(rows[0].sttLanguage));

  let body: unknown;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) {
      // 403 here is almost always an instance without `json` in
      // `search.formats`, and 429 its bot limiter. Both are setup, not the
      // query, and both are worth a line in the log.
      console.warn(`[search] SearXNG answered ${res.status}`);
      return NextResponse.json(
        { ok: false, error: `The search engine refused the request (${res.status}).` },
        noStore,
      );
    }
    body = await res.json();
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    console.warn(`[search] SearXNG ${timedOut ? "timed out" : `unreachable: ${String(err)}`}`);
    return NextResponse.json(
      { ok: false, error: timedOut ? "The search took too long and was abandoned." : "The search engine could not be reached." },
      noStore,
    );
  }

  return NextResponse.json(searchResultForModel(call.query, body), noStore);
}
