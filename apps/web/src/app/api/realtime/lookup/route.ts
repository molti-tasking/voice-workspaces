import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import {
  LOOKUP_MAX_QUERY_CHARS,
  lookupFoundLabel,
  mockSearchMessages,
  parseMockSearch,
  renderLocalTime,
  timeZoneOf,
} from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The speech-to-speech agent's `web_search`, answered by the MOCK search
 * (`lookup.ts` in @voicemural/talkback): the browser posts the query the
 * agent asked for, and gets back results the fast model made up, plus the
 * few words the screen shows under the query.
 *
 * Off unless `REALTIME_MOCK_SEARCH=on`, the same switch that offers the tool
 * to the agent (`/api/realtime/call`): made-up results must not reach a real
 * drive by accident.
 *
 * THE RESPONSE IS READ BY THE MODEL, like `/search`'s: a failure is HTTP 200
 * with `ok: false` and a sentence it can say. Session-authorised, with
 * ownership of the drive re-resolved. The query is never logged.
 */

const LOOKUP_TIMEOUT_MS = 8_000;

const Body = z.object({
  captureSessionId: z.uuid(),
  query: z.string().trim().min(1).max(LOOKUP_MAX_QUERY_CHARS),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId, query } = parsed.data;

  const [row] = await getDb()
    .select({ userId: captureSession.userId, deviceInfo: captureSession.deviceInfo })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (row?.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const headers = { "Cache-Control": "no-store" };
  if (process.env.REALTIME_MOCK_SEARCH?.trim().toLowerCase() !== "on") {
    return NextResponse.json({ ok: false, error: "Looking things up is not set up.", found: "Not available" }, { headers });
  }

  try {
    const result = await chat(mockSearchMessages(query, renderLocalTime(new Date(), timeZoneOf(row.deviceInfo))), {
      role: "fast",
      temperature: 0.4,
      maxTokens: 700,
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      metadata: { generation_name: "mock_web_search", session_id: captureSessionId },
    });
    const results = parseMockSearch(result.content);
    if (!results) {
      return NextResponse.json({ ok: false, error: "The search came back empty.", found: lookupFoundLabel(0) }, { headers });
    }
    return NextResponse.json({ ok: true, results, found: lookupFoundLabel(results.length) }, { headers });
  } catch (err) {
    console.warn("mock search failed", { captureSessionId, err: String(err) });
    return NextResponse.json({ ok: false, error: "The search did not answer in time.", found: "Search failed" }, { headers });
  }
}
