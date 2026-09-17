"use client";

import {
  PipecatClient,
  RTVIEvent,
  type Participant,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { useEffect, useState } from "react";
import { subscribeStream } from "@/lib/recorder/mic-bus";
import { OFF, type TalkbackOptions, type TalkbackState } from "./types";

/**
 * The live conversation, over Pipecat.
 *
 * The client half of the voice service. Kept behind `useTalkback` — same
 * state, same options, same rule that capture must not depend on it — so the
 * two can be swapped by one env var and judged on how they SOUND rather than on
 * how they are wired.
 *
 * SmallWebRTC is peer-to-peer: the browser negotiates directly with the Python
 * container and there is no media server in between. So this backend needs no
 * equivalent of a media server, and it still gets the browser's real echo
 * canceller, because the media path is WebRTC either way.
 */
/**
 * How the BROWSER finds a path to the container for the audio.
 *
 * The mirror of `ICE_SERVERS` in apps/pipecat/bot.py, and needed for the same
 * reason on this side: only the SDP exchange goes over HTTPS, the media is
 * peer-to-peer. A browser behind a home router has to learn its own public
 * mapping before the container can send it anything.
 *
 * Comma-separated, and inlined at BUILD time like every NEXT_PUBLIC_ value —
 * changing it needs a rebuild, not a restart. Empty disables ICE servers, which
 * is right on a LAN and wrong anywhere else.
 */
const ICE_SERVERS: RTCIceServer[] = (
  process.env.NEXT_PUBLIC_ICE_SERVERS || "stun:stun.l.google.com:19302"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)
  .map((urls) => ({ urls }));

export function usePipecatTalkback(options: TalkbackOptions): TalkbackState {
  const { captureSessionId, enabled } = options;
  const [state, setState] = useState<TalkbackState>(OFF);

  useEffect(() => {
    if (!enabled || !captureSessionId) return;

    let disposed = false;
    let client: PipecatClient | null = null;
    let audioEl: HTMLAudioElement | null = null;

    const patch = (next: Partial<TalkbackState>) =>
      setState((prev) => ({ ...prev, ...next }));

    async function connect(stream: MediaStream): Promise<void> {
      const [micTrack] = stream.getAudioTracks();
      if (!micTrack || disposed) return;

      /* `||`, NOT `??`.
       *
       * docker-compose passes `NEXT_PUBLIC_PIPECAT_URL=${NEXT_PUBLIC_PIPECAT_URL:-}`,
       * so an unset variable arrives as an EMPTY STRING rather than undefined —
       * and `"" ?? fallback` is `""`. That silently makes the endpoint `/offer`
       * on the app's own origin, where Next answers 404 and the only symptom is
       * a "talk offline" pill. An empty value has to mean "not configured". */
      const url =
        process.env.NEXT_PUBLIC_PIPECAT_URL || "http://localhost:7860";
      patch({ status: "connecting", memory: "ready", error: null });
      console.info(`[talkback:pipecat] connecting to ${url}`);

      /* The Python container has no Better Auth session and should not gain
       * one, so it carries a signed ticket instead — the same mechanism the
       * WebSocket path uses. It spends this once per turn against
       * /api/realtime/context to find out what the driver has said before.
       *
       * Talk-back degrades rather than fails if this cannot be minted: the
       * agent still converses, it just has no memory of past drives. */
      let ticket: string | null = null;
      try {
        const res = await fetch("/api/realtime/ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureSessionId, scope: "context" }),
        });
        if (res.ok) ({ ticket } = (await res.json()) as { ticket: string });
        else
          console.warn(`[talkback:pipecat] no context ticket — ${res.status}`);
      } catch (err) {
        console.warn(`[talkback:pipecat] no context ticket — ${String(err)}`);
      }
      if (disposed) return;
      // Say so on the screen, not only in a console nobody is reading while
      // driving. Without a ticket the bot runs its degraded prompt and knows
      // nothing about this person, which is a materially different session and
      // should not be discovered afterwards from thin answers.
      if (!ticket) patch({ memory: "unavailable" });

      const next = new PipecatClient({
        transport: new SmallWebRTCTransport({
          /* THE BROWSER NEEDS STUN TOO, and forgetting it fails in a way that
           * looks like a server problem.
           *
           * Without this the browser gathers only `host` candidates — the
           * 192.168.x address of the machine — and offers those to a container
           * that cannot route to a private LAN. The container's own candidates
           * are fine (it publishes a public srflx via ICE_SERVERS), but ICE
           * needs a path BOTH ways: the peer must be able to answer. So the
           * call reaches `checking` and sits there until it times out.
           *
           * On a LAN this never shows up, because host candidates are directly
           * reachable — which is exactly why it survived every local test and
           * only appeared once the container was in a datacentre.
           *
           * Build-time, like the URL above: it is baked into the bundle. */
          iceServers: ICE_SERVERS,
          /* GATHER FIRST, THEN OFFER — do not trickle.
           *
           * Left at its default of false, the transport POSTs the offer
           * immediately and trickles candidates afterwards by PATCHing
           * /offer with the `pc_id` the answer carried. But `onicecandidate`
           * starts firing the moment the local description is set, which is
           * while that POST is still in flight, and the flush is gated only on
           * a `_canSendIceCandidates` flag that survives from the previous
           * connection. On any second attempt — a reconnect, a renegotiation —
           * the flag is already true while `pc_id` is still the old closed
           * one, so the candidates PATCH against an id the container has
           * already popped and get a 404 `unknown pc_id`. They are then gone:
           * there is no retry, and the browser's candidates never arrive.
           * The container is left with only its own, so ICE reaches `checking`
           * and stays there until it times out — which looks like a NAT
           * problem and reads, on the screen, as a `talk…` pill that never
           * resolves.
           *
           * Waiting instead puts every candidate in the SDP offer itself,
           * where the pc_id race cannot exist because there is no second
           * request. Bounded at 2s by the transport, which resolves rather
           * than rejects on timeout, so a blocked STUN server costs a short
           * delay instead of the connection. */
          waitForICEGathering: true,
          webrtcRequestParams: {
            endpoint: `${url}/offer`,
            // Rides along with the SDP offer, so the bot has it before the
            // first word rather than after the first turn.
            requestData: { ticket, captureSessionId },
          },
        }),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onBotStartedSpeaking: () => patch({ status: "speaking" }),
          onBotStoppedSpeaking: () => patch({ status: "listening" }),
          onDisconnected: () => {
            if (!disposed)
              patch({ status: "degraded", error: "connection lost" });
          },
        },
      });
      client = next;

      /* THE LIVE TOPIC TITLE, pushed by the container.
       *
       * The screen used to render the last eight turns of the exchange. It was
       * the wrong thing to show somebody in a car cradle — reading is the one
       * thing they cannot do — and it re-rendered this provider on every
       * streamed fragment of every reply, on a phone that is also holding a
       * MediaRecorder open. Two to four words naming the subject costs one
       * render when the subject actually changes.
       *
       * Named in the voice container rather than here or in the worker: it sits
       * next to the running summary, on the freshest copy of what was said (see
       * `TopicTitle` in apps/pipecat/bot.py), and rides the data channel that
       * the audio already needs — so the phone makes no extra request.
       *
       * `serverMessage` carries the frame's `data` payload directly and is
       * typed `any`, so this is the boundary where it gets checked: an older
       * container sends nothing at all, and a future one may send other kinds
       * of server message through the same event. */
      next.on(RTVIEvent.ServerMessage, (data) => {
        if (data?.type !== "title") return;
        const { title } = data as { title?: unknown };
        if (typeof title === "string") patch({ title });
      });

      next.on(
        RTVIEvent.TrackStarted,
        (track: MediaStreamTrack, participant?: Participant) => {
          // The agent's voice. Played through an element in this page, so it is
          // part of the render stream the echo canceller references — which is
          // what lets the microphone stay open while the agent speaks.
          if (participant?.local || track.kind !== "audio") return;
          audioEl ??= new Audio();
          audioEl.autoplay = true;
          audioEl.srcObject = new MediaStream([track]);
          void audioEl.play().catch(() => undefined);
        },
      );

       /* THE ONE KNOWN HAZARD TO THE LEDGER, stated plainly
        * because it is a confound in the comparison and not an implementation
        * detail.
        *
        * A transport that accepted an existing MediaStreamTrack would avoid
        * this. As it stands the client owns its capture through its
        * MediaManager and only accepts a DEVICE id, so a second getUserMedia is
        * unavoidable without subclassing internals the package does not
        * export. Pinning it to the recorder's own device at least keeps both
        * on one microphone.
       *
       * The risk that creates is the plan's: a second capture can renegotiate
       * the device and perturb the MediaRecorder writing the verbatim ledger.
       * So rather than assert it does not happen, compare the settings before
       * and after and say so out loud. A silent narrowband downgrade of the
       * ledger is the one outcome that would matter more than the comparison. */
      const before = micTrack.getSettings();

      try {
        await next.initDevices();
        if (before.deviceId) next.updateMic(before.deviceId);

        await next.connect();
        if (disposed) return;
        patch({ status: "listening" });

        const after = micTrack.getSettings();
        const changed = (
          [
            "sampleRate",
            "channelCount",
            "echoCancellation",
            "deviceId",
          ] as const
        ).filter((key) => before[key] !== after[key]);
        if (changed.length > 0) {
          console.warn(
            "[talkback:pipecat] the recorder's track changed when the second capture opened —",
            "the ledger for this drive is affected:",
            Object.fromEntries(changed.map((k) => [k, [before[k], after[k]]])),
          );
        }
      } catch (err) {
        /* Flattened to a STRING deliberately. Next's browser-log bridge
         * serialises console arguments, and an Error instance came through it
         * as the literal text `undefined` — which said only that connecting
         * failed, not why, and cost a whole test drive to get behind. */
        const why =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : typeof err === "string"
              ? err
              : JSON.stringify(err) || String(err);
        console.warn(`[talkback:pipecat] could not connect — ${why}`);
        patch({ status: "degraded", error: "could not connect" });
      }
    }

    const unsubscribe = subscribeStream((stream) => {
      if (disposed) return;
      if (stream) void connect(stream);
      else void client?.disconnect();
    });

    return () => {
      disposed = true;
      unsubscribe();
      void client?.disconnect();
      client = null;
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl = null;
      }
    };
  }, [enabled, captureSessionId]);

  if (!enabled || !captureSessionId) return OFF;
  return state;
}
