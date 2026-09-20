"use client";

import {
  PipecatClient,
  RTVIEvent,
  type Participant,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { useEffect, useState } from "react";
import { earcon } from "@/lib/recorder/earcon";
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
 * How the BROWSER finds a path to the container for the audio — the FALLBACK.
 *
 * The mirror of `ICE_SERVERS` in apps/pipecat/bot.py, and needed for the same
 * reason on this side: only the SDP exchange goes over HTTPS, the media is
 * peer-to-peer. A browser behind a home router has to learn its own public
 * mapping before the container can send it anything.
 *
 * STUN ONLY, and that is the whole reason this is no longer the primary source.
 * A relay needs a credential, and every NEXT_PUBLIC_ value is inlined at BUILD
 * time into a bundle anyone can read — so a TURN credential put here would be
 * public and permanent. `/api/realtime/ice` mints one per connection instead,
 * and this is what is used when that route cannot be reached.
 *
 * Comma-separated. Empty disables ICE servers, which is right on a LAN and
 * wrong anywhere else.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = (
  process.env.NEXT_PUBLIC_ICE_SERVERS || "stun:stun.l.google.com:19302"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)
  .map((urls) => ({ urls }));

/**
 * The ICE configuration for this connection, relay credential and all.
 *
 * WHY A RELAY IS NOT OPTIONAL. STUN gets a path whenever one side can be
 * hole-punched, which is why talk-back worked from a desk on Wi-Fi for weeks
 * and failed on the first drive that used it for what it is for. Mobile
 * carriers run carrier-grade NAT, which is typically symmetric: the mapping the
 * phone learns from STUN is not the mapping the container sends to, no
 * candidate pair ever forms, and the call sits in `checking` until it times out
 * about a minute later. The bot composes its opening line and speaks it into a
 * transport with no path; the only symptom is silence.
 *
 * Failure here is NOT fatal and must not be: without TURN the call still
 * connects wherever STUN is enough, which includes every LAN and most home
 * broadband. Degrading to the build-time list is strictly better than refusing
 * to connect at all.
 */
async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/realtime/ice", { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[talkback:pipecat] no ICE config — ${res.status}`);
      return FALLBACK_ICE_SERVERS;
    }
    const { iceServers: servers } = (await res.json()) as {
      iceServers: RTCIceServer[];
    };
    // An empty list is a legitimate answer on a LAN, but so is a malformed one
    // from an older deployment, and the two are indistinguishable here. Prefer
    // the build-time list, which at least names a STUN server.
    if (!Array.isArray(servers) || servers.length === 0) {
      return FALLBACK_ICE_SERVERS;
    }
    console.info(
      `[talkback:pipecat] ICE: ${servers.length} server(s), relay ${
        servers.some((s) => s.username) ? "available" : "NOT configured"
      }`,
    );
    return servers;
  } catch (err) {
    console.warn(`[talkback:pipecat] no ICE config — ${String(err)}`);
    return FALLBACK_ICE_SERVERS;
  }
}

export function usePipecatTalkback(options: TalkbackOptions): TalkbackState {
  const { captureSessionId, enabled } = options;
  const [state, setState] = useState<TalkbackState>(OFF);

  useEffect(() => {
    if (!enabled || !captureSessionId) return;

    let disposed = false;
    let client: PipecatClient | null = null;
    let audioEl: HTMLAudioElement | null = null;
    /* Whether a connection has been STARTED, set before the first await in
     * `connect` rather than when the client lands. It is what tells a stop
     * from a stream that has simply not been published yet, and it has to be
     * true for the whole of `connect` — a Stop during its round trips must
     * still close what that call is about to open. */
    let opened = false;

    const patch = (next: Partial<TalkbackState>) =>
      setState((prev) => ({ ...prev, ...next }));

    async function connect(stream: MediaStream): Promise<void> {
      const [micTrack] = stream.getAudioTracks();
      if (!micTrack || disposed) return;
      opened = true;

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

      /* Started here and awaited below, so the relay credential is minted while
       * the context ticket is in flight rather than after it. Two round trips in
       * series before the first word is two too many when the driver has
       * already started talking. */
      const icePromise = iceServers();

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

      const ice = await icePromise;
      if (disposed) return;

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
           * Fetched per connection rather than baked into the bundle, because
           * the relay half of it is a credential — see `iceServers` above. */
          iceServers: ice,
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
        /* ONE SOFT NOTE: it can hear you now.
         *
         * "It is recording" and "it can hear me" are different facts, and the
         * second one arrives several seconds after the first — a handshake, a
         * ticket, a relay credential, ICE. Until now the only evidence either
         * way was a pill that appears when the connection has FAILED, which
         * asks somebody driving to notice the absence of a warning.
         *
         * Once per connection, and quieter than the transport pair, because
         * this is the good news rather than the state change. */
        earcon("ready");

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

    /* STOP CLOSES THE PEER CONNECTION, not just the microphone tap.
     *
     * The recorder publishes `null` when a drive ends, and this used to answer
     * it with a bare `client?.disconnect()` on the way past. That is the same
     * call, but nothing owned the outcome: the client reference stayed, the
     * audio element stayed, and a failed disconnect was invisible. Meanwhile
     * Stop ends the capture session over HTTPS immediately, so from that
     * moment the container is talking into a drive the database says is over —
     * and it only finds out when ICE gives up, which on the first formative
     * pilot took 52 seconds. Long enough for a silence timer to fire: an
     * `agent_turn` at offset 396984ms against an `ended_at` 52s earlier,
     * offering to look up something she had already said yes to.
     *
     * The container and the web app now refuse that write on their own (see
     * `resolveLiveSession` and `Offers._fire`). This is the first of the three
     * guards and the only one that stops it happening at all: end the call
     * where the drive ends. */
    async function teardown(): Promise<void> {
      const closing = client;
      client = null;
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl = null;
      }
      if (!closing) return;
      try {
        await closing.disconnect();
      } catch (err) {
        // Nothing to retry with — the effect is going away either way — but it
        // must not be silent: an un-closed peer connection is exactly the state
        // the pilot's stray turn was spoken from.
        console.warn(`[talkback:pipecat] could not close the connection — ${String(err)}`);
      }
    }

    const unsubscribe = subscribeStream((stream) => {
      if (disposed) return;
      if (stream) {
        void connect(stream);
        return;
      }
      // `subscribeStream` fires immediately with whatever it is holding, which
      // on a mount that beats the recorder's own publish is null. That is "not
      // up yet", not "stopped", and treating it as a stop would leave the
      // effect disposed and the drive permanently mute.
      if (!opened) return;
      // A real stop. Nothing may reconnect behind it, including a `connect`
      // still working through its round trips.
      disposed = true;
      void teardown();
    });

    return () => {
      disposed = true;
      unsubscribe();
      void teardown();
    };
  }, [enabled, captureSessionId]);

  if (!enabled || !captureSessionId) return OFF;
  return state;
}
