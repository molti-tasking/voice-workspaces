import { loadOps } from "@voicemural/db/workspace";
import {
  countUnclassified,
  cueVersion,
  loadLiveSession,
  loadSessionDirections,
} from "@voicemural/db/display";
import { diffWorkspace, foldWorkspace } from "@voicemural/workspace";
import { settingProfile } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the secondary display reads, streamed.
 *
 * ## Why this is not on the WebRTC data channel
 *
 * The acceptance criterion for the whole voice feature is that killing the
 * Pipecat container mid-recording changes nothing about capture: the timer
 * keeps counting, chunks keep uploading, the transcript fills in. The display
 * inherits that. Everything below comes out of Postgres — `workspace_op` for
 * content, `directive` for directions — so the panel keeps updating with the
 * container dead, and survives a page reload mid-session, because it was never
 * downstream of the conversation in the first place.
 *
 * ## Why SSE rather than router.refresh()
 *
 * Re-rendering the RSC tree every few seconds would run on a phone that is
 * already holding a MediaRecorder open and a peer connection up. This sends a
 * few hundred bytes when something changed and nothing when it did not, and
 * EventSource reconnects itself after a tunnel — which the recorder's whole
 * offline story assumes will happen.
 *
 * Authorised by the Better Auth session cookie, deliberately NOT by a realtime
 * ticket: the browser has a session and the container is not involved. Nothing
 * here should be reachable by the voice path.
 */

/** Server-side poll interval. Cheap: one indexed aggregate per tick. */
const TICK_MS = 3_000;

/** Stop streaming a session that has been closed for this long. */
const IDLE_CLOSE_MS = 60_000;

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return new Response("unauthorised", { status: 401 });

  const captureSessionId = new URL(req.url).searchParams.get("session");
  if (!captureSessionId) return new Response("missing session", { status: 400 });

  const session = await loadLiveSession(userId, captureSessionId);
  if (!session) return new Response("not found", { status: 404 });

  const profile = settingProfile(session.setting);

  // A setting with no screen gets no stream at all. Answering once and closing
  // is better than holding a connection open to send nothing, and it means the
  // "is there a display here" decision is made in exactly one place — the
  // profile — for both the agent's prompt and the browser.
  if (!profile.displayAllowed) {
    return Response.json(
      { displayAllowed: false, setting: session.setting ?? "driving" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastVersion = "";

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting. Nothing to do.
        }
      };

      req.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const current = await loadLiveSession(userId, captureSessionId);
          if (!current) return close();

          if (current.endedAt && Date.now() - current.endedAt.getTime() > IDLE_CLOSE_MS) {
            // The recording is over and the last extractions have landed. Let
            // the page keep whatever is on screen rather than clearing it.
            send("done", { reason: "session_ended" });
            return close();
          }

          const version = await cueVersion(userId, captureSessionId);
          if (version === lastVersion) return;
          lastVersion = version;

          send("cues", await buildCues(userId, current.startedAt, captureSessionId, profile));
        } catch (err) {
          // A transient database error must not kill the stream: the recorder
          // is mid-session and reconnecting costs a round trip for nothing.
          send("warn", { message: err instanceof Error ? err.message : "cue tick failed" });
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

async function buildCues(
  userId: string,
  startedAt: Date,
  captureSessionId: string,
  profile: { maxContentCues: number; maxDirectionCues: number },
) {
  /*
   * The content lane.
   *
   * `diffWorkspace(fold(untilSessionStart), fold(now))` already answers "what
   * has this recording contributed" — with provenance, already tested, already
   * the thing the workspace page renders as `?since=`. Reusing it means the
   * display adds no extraction path, no prompt and no cadence of its own, and
   * cannot drift from what the workspace will show afterwards.
   *
   * The cost is latency: extraction commits in fixed batches of eight
   * utterances, so a block appears 40-90s after it was said. That is the right
   * trade for a glanceable panel — the slow lane is the settled one.
   */
  const ops = await loadOps(userId);
  const before = foldWorkspace(ops, startedAt);
  const now = foldWorkspace(ops);
  const diff = diffWorkspace(before, now);

  const content = [...diff.addedBlocks, ...diff.revisedBlocks.map((r) => r.to)]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .slice(-Math.max(profile.maxContentCues * 2, profile.maxContentCues))
    .map((block) => ({
      id: block.id,
      text: block.text,
      kind: block.kind,
      topic: now.topics.find((t) => t.id === block.topicId)?.title ?? "",
      at: block.occurredAt.toISOString(),
    }));

  /* The fast lane. Classification runs per chunk, so these land ~15-25s behind
   * speech. Kept separate from content rather than merged: the two have
   * genuinely different latencies and different durability, and one list would
   * hide that. */
  const directions = (await loadSessionDirections(captureSessionId)).map((d) => ({
    id: d.utteranceId,
    text: d.restatement,
    verb: d.verb,
    resolved: d.resolved,
    at: d.createdAt.toISOString(),
  }));

  return {
    displayAllowed: true,
    content,
    directions,
    /* Not a spinner — a spinner invites monitoring, which is the opposite of a
     * glance. This is here so the panel can be honest about being behind rather
     * than looking finished, in the one place that matters: the end of a
     * recording, when the user is deciding whether to walk away. */
    pending: await countUnclassified(captureSessionId),
  };
}
