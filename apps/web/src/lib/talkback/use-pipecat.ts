"use client";

import { useEffect, useState } from "react";
import {
  PipecatClient,
  RTVIEvent,
  type BotOutputData,
  type Participant,
  type TranscriptData,
} from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { subscribeStream } from "@/lib/recorder/mic-bus";
import {
  MAX_VISIBLE_TURNS,
  OFF,
  type TalkbackOptions,
  type TalkbackState,
  type TalkbackTurn,
} from "./types";

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

      /* Both halves of the exchange, on screen as it happens.
       *
       * Appended rather than replaced: seeing only the latest line makes it
       * impossible to tell a misheard question from a bad answer, which is the
       * first thing anybody needs to know when a reply seems wrong. */
      const append = (
        role: TalkbackTurn["role"],
        text: string,
        key?: string,
      ) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setState((prev) => {
          const turns = [...prev.turns];
          const last = turns[turns.length - 1];
          // The bot streams one segment as several events, so a matching key
          // REPLACES rather than appends — otherwise a single sentence arrives
          // as a column of fragments.
          if (last && key && last.id === key) {
            turns[turns.length - 1] = { ...last, text: trimmed };
          } else {
            turns.push({
              id: key ?? `${role}-${Date.now()}-${turns.length}`,
              role,
              text: trimmed,
            });
          }
          return {
            ...prev,
            turns: turns.slice(-MAX_VISIBLE_TURNS),
            reply: role === "agent" ? trimmed : prev.reply,
          };
        });
      };

      next.on(RTVIEvent.UserTranscript, (data: TranscriptData) => {
        // Interim results rewrite themselves several times a second. Only the
        // final text is worth putting in front of someone driving.
        if (data?.final) append("you", data.text);
      });

      next.on(RTVIEvent.BotOutput, (data: BotOutputData) => {
        // A turn the silence gate declined never reaches the speaker, so it
        // must not appear here either — the screen should show what was said.
        if (data?.will_be_spoken === false) return;
        append(
          "agent",
          data.text,
          data.segment_id != null ? `agent-${data.segment_id}` : undefined,
        );
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
       * A transport that accepted an existing MediaStreamTrack would avoid this. It
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
