"use client";

import { useEffect, useState } from "react";
import {
  ConnectionState,
  LocalAudioTrack,
  RoomEvent,
  Room,
  Track,
  type RemoteTrack,
} from "livekit-client";
import { subscribeStream } from "@/lib/recorder/mic-bus";

/**
 * The live conversation, over LiveKit.
 *
 * REPLACES a hand-rolled WebSocket client, two AudioWorklets, an energy VAD and
 * a barge-in guard. That stack sounded broken in practice — the agent
 * interrupted itself on its own echo and speech arrived in disconnected chunks —
 * and both failures are things a WebRTC stack handles as a matter of course:
 * real echo cancellation against the actual render stream, jitter buffering,
 * packet loss concealment, and interruption gated on transcribed words rather
 * than on a signal threshold guessed from RMS.
 *
 * THE RULE THAT DID NOT CHANGE: capture must never depend on any of this. The
 * recorder still owns the microphone and still writes the ledger; this publishes
 * the SAME track into a room. If the room never connects, or drops mid-drive,
 * `MediaRecorder` and the upload queue carry on untouched.
 */

import type { TalkbackState } from "./types";
import { OFF } from "./types";

export function useLiveKitTalkback(options: { captureSessionId: string | null; enabled: boolean }) {
  const { captureSessionId, enabled } = options;
  const [state, setState] = useState<TalkbackState>(OFF);

  useEffect(() => {
    if (!enabled || !captureSessionId) return;

    let disposed = false;
    let room: Room | null = null;
    let published: LocalAudioTrack | null = null;

    const patch = (next: Partial<TalkbackState>) =>
      setState((prev) => ({ ...prev, ...next }));

    async function connect(stream: MediaStream): Promise<void> {
      const [micTrack] = stream.getAudioTracks();
      if (!micTrack || disposed) return;

      patch({ status: "connecting", error: null });

      let token: string;
      let url: string;
      try {
        const res = await fetch("/api/realtime/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureSessionId }),
        });
        if (!res.ok) throw new Error(`token ${res.status}`);
        ({ token, url } = (await res.json()) as { token: string; url: string });
      } catch (err) {
        console.warn("[talkback] could not get a LiveKit token", err);
        patch({ status: "degraded", error: "talk-back unavailable" });
        return;
      }
      if (disposed) return;

      const next = new Room({
        // Echo cancellation is the entire reason this migration happened. It is
        // requested on the recorder's getUserMedia already; this makes sure
        // LiveKit does not renegotiate it away.
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      room = next;

      next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        // The agent's voice. Attaching creates an element inside the page, so
        // playback is part of the render stream that AEC references — which is
        // what lets the microphone stay open while it speaks.
        if (track.kind === Track.Kind.Audio) track.attach();
      });

      next.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const fromAgent = participant?.identity?.startsWith("agent");
        const text = segments.map((s) => s.text).join(" ").trim();
        if (fromAgent && text) patch({ reply: text });
      });

      next.on(RoomEvent.ConnectionStateChanged, (connectionState) => {
        if (connectionState === ConnectionState.Connected) patch({ status: "listening" });
        if (connectionState === ConnectionState.Reconnecting) patch({ status: "degraded" });
        if (connectionState === ConnectionState.Disconnected && !disposed) {
          patch({ status: "degraded", error: "connection lost" });
        }
      });

      try {
        await next.connect(url, token);
        if (disposed) return;

        /* Publish the RECORDER'S track, not a new one.
         *
         * `getUserMedia` a second time can renegotiate the device, spawn a
         * second echo canceller, and on some Android builds perturb the
         * MediaRecorder that is producing the verbatim ledger. Sharing the one
         * track is what keeps capture and conversation independent. */
        published = new LocalAudioTrack(micTrack);
        await next.localParticipant.publishTrack(published);
        patch({ status: "listening" });
      } catch (err) {
        console.warn("[talkback] could not join the room", err);
        patch({ status: "degraded", error: "could not join" });
      }
    }

    const unsubscribe = subscribeStream((stream) => {
      if (disposed) return;
      if (stream) void connect(stream);
      else void room?.disconnect();
    });

    return () => {
      disposed = true;
      unsubscribe();
      // Unpublish without stopping: the track belongs to the recorder, and
      // stopping it here would end the drive's capture.
      if (published) void room?.localParticipant.unpublishTrack(published, false);
      void room?.disconnect();
      room = null;
    };
  }, [enabled, captureSessionId]);

  if (!enabled || !captureSessionId) return OFF;
  return state;
}
