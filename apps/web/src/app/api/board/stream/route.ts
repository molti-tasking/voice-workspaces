import { boardEnabledAt, boardVersion } from "@voicemural/db/board";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tells an open board that its op log has changed, so it can redraw.
 *
 * The board is folded on the server from `workspace_op`, and three things
 * write there while someone is looking at it: the agent's tool calls during a
 * drive ("Dropped the asymmetry argument"), the extractor committing a batch,
 * and a drag on another device. Before this, none of them showed until a
 * reload — so the agent could say it had dropped a card while the board in
 * front of the person still had it in `next`.
 *
 * SENDS A VERSION, NOT A BOARD. The fold, the judging and the markers stay in
 * the page's server render; this only says when that render is stale, and the
 * browser asks for a fresh one (`router.refresh`). One indexed aggregate per
 * tick, a few bytes when something changed, nothing when it did not.
 *
 * Postgres, not the WebRTC data channel, for the reason the cue panel gives:
 * the extractor and other devices never touch the conversation, and the board
 * must keep up with the voice container down.
 *
 * Authorised by the session cookie, like the page itself. Not found while the
 * board is switched off, like the page itself.
 */

/** How often the op log is checked. Short: this is the "it just happened" view. */
const TICK_MS = 2_000;

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return new Response("unauthorised", { status: 401 });
  if (!(await boardEnabledAt(userId))) return new Response("not found", { status: 404 });

  // The polling fallback (see board-live.tsx) asks for one answer as JSON.
  if ((req.headers.get("accept") ?? "").includes("application/json")) {
    return Response.json({ version: await boardVersion(userId) }, { headers: { "Cache-Control": "no-store" } });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let last = "";

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      req.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const version = await boardVersion(userId);
          // Sent on connect as well as on change: the browser compares it with
          // the version its page was drawn from, which may already be behind.
          if (version === last) return;
          last = version;
          controller.enqueue(encoder.encode(`event: version\ndata: ${JSON.stringify({ version })}\n\n`));
        } catch {
          // A transient database error must not end the stream; the next tick
          // tries again.
        }
      };

      const timer = setInterval(() => void tick(), TICK_MS);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer text/event-stream into uselessness otherwise.
      "X-Accel-Buffering": "no",
    },
  });
}
