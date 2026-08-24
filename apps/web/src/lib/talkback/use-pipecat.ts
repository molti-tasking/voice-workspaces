"use client";

import { useEffect, useState } from "react";
import { PipecatClient, RTVIEvent, type BotLLMTextData, type Participant } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { subscribeStream } from "@/lib/recorder/mic-bus";
import { OFF, type TalkbackOptions, type TalkbackState } from "./types";

/**
 * The live conversation, over Pipecat.
 *
 * The alternative to `use-livekit.ts`, deliberately the same shape — same
 * state, same options, same rule that capture must not depend on it — so the
 * two can be swapped by one env var and judged on how they SOUND rather than on
 * how they are wired.
 *
 * SmallWebRTC is peer-to-peer: the browser negotiates directly with the Python
 * container and there is no media server in between. So this backend needs no
 * equivalent of the `livekit` service, and it still gets the browser's real echo
 * canceller, because the media path is WebRTC either way.
 */
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

      const url = process.env.NEXT_PUBLIC_PIPECAT_URL ?? "http://localhost:7860";
      patch({ status: "connecting", error: null });

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
        else console.warn(`[talkback:pipecat] no context ticket — ${res.status}`);
      } catch (err) {
        console.warn(`[talkback:pipecat] no context ticket — ${String(err)}`);
      }
      if (disposed) return;

      const next = new PipecatClient({
        transport: new SmallWebRTCTransport({
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
            if (!disposed) patch({ status: "degraded", error: "connection lost" });
          },
        },
      });
      client = next;

      next.on(RTVIEvent.BotTranscript, (data: BotLLMTextData) => {
        if (data?.text) patch({ reply: data.text });
      });

      next.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant?: Participant) => {
        // The agent's voice. Played through an element in this page, so it is
        // part of the render stream the echo canceller references — which is
        // what lets the microphone stay open while the agent speaks.
        if (participant?.local || track.kind !== "audio") return;
        audioEl ??= new Audio();
        audioEl.autoplay = true;
        audioEl.srcObject = new MediaStream([track]);
        void audioEl.play().catch(() => undefined);
      });

      /* THE ONE PLACE THIS DIFFERS FROM THE LIVEKIT BACKEND, stated plainly
       * because it is a confound in the comparison and not an implementation
       * detail.
       *
       * LiveKit lets us publish the recorder's existing MediaStreamTrack. This
       * client owns its capture through its MediaManager and only accepts a
       * DEVICE id, so a second getUserMedia is unavoidable without subclassing
       * internals the package does not export. Pinning it to the recorder's own
       * device at least keeps both on one microphone.
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
        const changed = (["sampleRate", "channelCount", "echoCancellation", "deviceId"] as const)
          .filter((key) => before[key] !== after[key]);
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
