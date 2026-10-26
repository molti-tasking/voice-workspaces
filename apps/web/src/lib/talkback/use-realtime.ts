"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REALTIME_POKE_NUDGE,
  REALTIME_RESUME_NOTE,
  REALTIME_UNLOCK_NOTE,
  realtimeSparkNudge,
  type RealtimeTurnDetection,
} from "@voicemural/talkback/realtime";
import { earcon } from "@/lib/recorder/earcon";
import type { Floor } from "@/lib/recorder/floor-store";
import { subscribeStream } from "@/lib/recorder/mic-bus";
import { RealtimeConversation } from "./realtime/events";
import { DriveRecords, type CallRecords } from "./realtime/records";
import { Titler } from "./realtime/titler";
import { OFF, type PokeResult, type SparkRequest, type Talkback, type TalkbackOptions, type TalkbackState } from "./types";

/**
 * The live conversation, with a speech-to-speech model.
 *
 * The browser talks to the model itself: `/api/realtime/call` composes the
 * agent and mints a secret for one session through the LiteLLM proxy, the
 * browser offers its audio to the proxy with it, and the audio then flows
 * between the phone and the provider over WebRTC. No container, no media
 * server and no relay of our own: the provider's side is publicly reachable,
 * so a phone behind a carrier's NAT connects without one.
 *
 * THE RECORDER'S OWN TRACK. A plain `RTCPeerConnection` takes a track, so the
 * agent hears the very track the recorder is writing the ledger from — one
 * capture, one echo canceller, none of the second `getUserMedia` the Pipecat
 * client needed. Pausing replaces it with nothing on the sender rather than
 * disabling it, which would silence the ledger too.
 *
 * WHAT THE CONTAINER DID, DONE HERE. Their turns and the agent's, for the
 * views (`realtime/events.ts`); the topic titles and subjects (`Titler`); the
 * records (`DriveRecords`). The floor and the display study's pause are the
 * session's own switch — no reply is created for a turn while locked or
 * paused — and a poke is a note to the model and a response asked for.
 *
 * Kept behind `useTalkback` with the same state and options as the Pipecat
 * hook, so either engine runs every screen (`NEXT_PUBLIC_VOICE_ENGINE`).
 */

interface Call extends CallRecords {
  clientSecret: string;
  callsUrl: string;
  openingNudge: string | null;
  turnDetection: RealtimeTurnDetection;
}

/** One peer connection to the provider. A reconnect is a new one. */
interface Connection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  sender: RTCRtpSender;
  track: MediaStreamTrack;
  audio: HTMLAudioElement;
  call: Call;
  conversation: RealtimeConversation;
  /** The floor last asked of the session, and the one it confirmed. */
  askedFloor: Floor | null;
  appliedFloor: Floor | null;
  wasPaused: boolean;
  userSpeaking: boolean;
  /** A poke made while they were talking, fired when their turn is over. */
  armed: SparkRequest | "poke" | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/** Reconnects before giving up on a drive, and the wait before each. */
const RECONNECT_TRIES = 3;
const RECONNECT_DELAY_MS = 2000;
/** How long `disconnected` may last before it counts as lost (ICE often recovers by itself). */
const DISCONNECTED_GRACE_MS = 5000;
/** How much of the conversation so far a reconnected agent is told. */
const HISTORY_CHARS = 3000;

function systemNote(text: string) {
  return {
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
  };
}

function send(c: Connection, event: Record<string, unknown>): void {
  if (c.dc.readyState === "open") c.dc.send(JSON.stringify(event));
}

/** No reply is created for their turn while locked or paused; the session is told whole. */
function applyTurnDetection(c: Connection, floor: Floor, paused: boolean): void {
  c.askedFloor = floor;
  send(c, {
    type: "session.update",
    session: {
      type: "realtime",
      audio: { input: { turn_detection: { ...c.call.turnDetection, create_response: floor !== "locked" && !paused } } },
    },
  });
}

function why(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : JSON.stringify(err) || String(err);
}

/** What was said before the connection dropped, as one note for the new session. */
function historyNote(lines: { who: "user" | "agent"; text: string }[]): string | null {
  const text = lines
    .map((l) => `${l.who === "user" ? "They" : "You"}: ${l.text.trim()}`)
    .join("\n")
    .slice(-HISTORY_CHARS);
  if (!text) return null;
  return `(The connection dropped and is back. This is what was said in this conversation before it dropped. Carry on from it; do not recap it, and do not speak first.)\n${text}`;
}

export function useRealtimeTalkback(options: TalkbackOptions): Talkback {
  const { captureSessionId, enabled, floor, paused = false } = options;
  const [state, setState] = useState<TalkbackState>(OFF);

  // The latest options, read by the connection when it needs them rather than
  // reconnecting whenever they change.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const live = useRef<Connection | null>(null);
  const titlerRef = useRef<Titler | null>(null);
  const recordsRef = useRef<DriveRecords | null>(null);

  // A new drive starts from nothing (see the Pipecat hook for why this is
  // adjusted during render).
  const [stateFor, setStateFor] = useState(captureSessionId);
  if (stateFor !== captureSessionId) {
    setStateFor(captureSessionId);
    setState(OFF);
  }

  const patch = useCallback((next: Partial<TalkbackState>) => setState((prev) => ({ ...prev, ...next })), []);

  /** Ask for one response, with the note that says what it is for. */
  const fire = useCallback((c: Connection, spark: SparkRequest | null) => {
    const subject = spark ? titlerRef.current?.titleFor(spark.ordinal) : null;
    const note = spark && subject ? realtimeSparkNudge(spark.kind, subject, spark.question) : REALTIME_POKE_NUDGE;
    c.conversation.expect("poke", spark ? { kind: spark.kind, ordinal: spark.ordinal } : null);
    send(c, systemNote(note));
    send(c, { type: "response.create" });
  }, []);

  useEffect(() => {
    if (!enabled || !captureSessionId) return;
    const driveId = captureSessionId;

    let disposed = false;
    let opened = false;
    let stream: MediaStream | null = null;
    let current: Connection | null = null;
    let tries = 0;
    let connections = 0;

    function close(c: Connection): void {
      if (c.disconnectTimer !== null) clearTimeout(c.disconnectTimer);
      c.conversation.close();
      c.dc.onmessage = null;
      c.dc.onclose = null;
      c.pc.onconnectionstatechange = null;
      try {
        c.dc.close();
        c.pc.close();
      } catch (err) {
        console.warn(`[talkback:realtime] could not close the connection — ${why(err)}`);
      }
      c.audio.srcObject = null;
    }

    /** This connection is gone: try again, a few times, then say so. */
    function lost(c: Connection | null, reason: string): void {
      if (c && current !== c) return;
      if (c) {
        current = null;
        live.current = null;
        close(c);
      }
      if (disposed) return;
      console.warn(`[talkback:realtime] ${reason}`);
      if (tries >= RECONNECT_TRIES || !stream) {
        patch({ status: "degraded", error: c ? "connection lost" : "could not connect", userSpeaking: false });
        return;
      }
      tries += 1;
      patch({ status: "connecting", userSpeaking: false });
      const again = stream;
      setTimeout(() => {
        if (!disposed && current === null) void connect(again);
      }, RECONNECT_DELAY_MS);
    }

    function onOpen(c: Connection): void {
      if (current !== c) return;
      tries = 0;
      patch({ status: "listening", error: null });
      const { floor: wanted, paused: pausedNow = false } = latest.current;
      applyTurnDetection(c, wanted, pausedNow);
      c.wasPaused = pausedNow;
      recordsRef.current?.floor(wanted, true);
      if (connections > 1) {
        const note = historyNote(latest.current.history?.() ?? []);
        if (note) send(c, systemNote(note));
      } else {
        earcon("ready");
        const fresh = (latest.current.history?.() ?? []).length === 0;
        if (c.call.openingNudge && fresh && !pausedNow && wanted !== "locked") {
          c.conversation.expect("opening");
          send(c, systemNote(c.call.openingNudge));
          send(c, { type: "response.create" });
        }
      }
    }

    function onEvent(c: Connection, event: { type: string; [key: string]: unknown }): void {
      if (current !== c) return;
      if (event.type === "session.updated" && c.askedFloor !== null) {
        const applied = c.askedFloor;
        if (applied === "open" && c.appliedFloor === "locked") send(c, systemNote(REALTIME_UNLOCK_NOTE));
        if (c.appliedFloor !== null && applied !== c.appliedFloor) recordsRef.current?.floor(applied);
        c.appliedFloor = applied;
        c.askedFloor = null;
        patch({ floor: applied });
      } else if (event.type === "error") {
        const error = (event.error ?? {}) as { message?: unknown; code?: unknown };
        console.warn(`[talkback:realtime] provider error — ${String(error.code ?? "")} ${String(error.message ?? "")}`);
      }
      c.conversation.handle(event);
    }

    async function connect(next: MediaStream): Promise<void> {
      const [track] = next.getAudioTracks();
      if (!track || disposed) return;
      opened = true;
      stream = next;
      patch({ status: "connecting", error: null });

      let call: Call;
      try {
        const res = await fetch("/api/realtime/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureSessionId: driveId }),
          cache: "no-store",
        });
        // An ended drive takes no call: Stop got there first.
        if (res.status === 409) return;
        if (!res.ok) throw new Error(`no call — ${res.status}`);
        call = (await res.json()) as Call;
      } catch (err) {
        lost(null, `could not start a call — ${why(err)}`);
        return;
      }
      if (disposed) return;
      if (!call.ticket) patch({ memory: "unavailable" });
      else patch({ memory: "ready" });

      recordsRef.current = recordsRef.current ? recordsRef.current.resume(call) : new DriveRecords(call);
      titlerRef.current ??= new Titler(
        {
          now: () => Date.now(),
          name: async (currentTitle, earlier, recent) => {
            const res = await fetch("/api/realtime/topic", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ captureSessionId: driveId, name: { current: currentTitle, earlier, recent } }),
            });
            return res.ok ? (((await res.json()) as { title?: string | null }).title ?? null) : null;
          },
          judge: async (title, said) => {
            const res = await fetch("/api/realtime/topic", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ captureSessionId: driveId, settled: { title, said } }),
            });
            return res.ok ? (((await res.json()) as { settled?: boolean | null }).settled ?? null) : null;
          },
          emit: (message) => latest.current.onMessage(message),
          saveTitle: (title) => recordsRef.current?.title(title),
          saveVisit: (visit) => recordsRef.current?.visit(visit),
        },
        call.startedAtEpochMs,
        latest.current.titles(),
      );
      const titler = titlerRef.current;

      const pc = new RTCPeerConnection();
      const sender = pc.addTrack(track, next);
      if (latest.current.paused) await sender.replaceTrack(null);
      const audio = new Audio();
      audio.autoplay = true;
      // The agent's voice, played through an element in this page so it is
      // part of what the echo canceller references.
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void audio.play().catch(() => undefined);
      };
      const dc = pc.createDataChannel("oai-events");

      const fireArmed = () => {
        const armed = c.armed;
        if (armed === null || latest.current.paused) return;
        c.armed = null;
        fire(c, armed === "poke" ? null : armed);
      };
      // Its callbacks run only once events arrive, after `c` below exists.
      const conversation = new RealtimeConversation({
        now: () => Date.now(),
        emit: (message) => latest.current.onMessage(message),
        began: (id) => titler.began(id),
        heard: (who, text) => titler.heard(who, text),
        userSpeaking: (on) => {
          c.userSpeaking = on;
          patch({ userSpeaking: on });
        },
        agentSpeaking: (on) => {
          if (current === c) patch({ status: on ? "speaking" : "listening" });
        },
        finished: (turn) => void recordsRef.current?.turn(turn),
        // Locked, their turn creates no reply, so an armed poke goes now;
        // open, it waits for the reply their turn gets.
        turnEnded: () => {
          if (latest.current.floor === "locked") fireArmed();
        },
        responseDone: fireArmed,
      });
      const c: Connection = {
        pc,
        dc,
        sender,
        track,
        audio,
        call,
        conversation,
        askedFloor: null,
        appliedFloor: null,
        wasPaused: false,
        userSpeaking: false,
        armed: null,
        disconnectTimer: null,
      };

      dc.onopen = () => onOpen(c);
      dc.onmessage = (m) => {
        let event: { type: string };
        try {
          event = JSON.parse(String(m.data)) as { type: string };
        } catch {
          return;
        }
        onEvent(c, event);
      };
      dc.onclose = () => lost(c, "the session closed");
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "failed") lost(c, "the connection failed");
        else if (s === "disconnected") {
          c.disconnectTimer ??= setTimeout(() => lost(c, "the connection dropped"), DISCONNECTED_GRACE_MS);
        } else if (s === "connected" && c.disconnectTimer !== null) {
          clearTimeout(c.disconnectTimer);
          c.disconnectTimer = null;
        }
      };

      current = c;
      live.current = c;
      connections += 1;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const res = await fetch(call.callsUrl, {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${call.clientSecret}`, "Content-Type": "application/sdp" },
        });
        if (!res.ok) throw new Error(`the provider refused the call — ${res.status} ${(await res.text()).slice(0, 200)}`);
        if (disposed || current !== c) return;
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      } catch (err) {
        lost(c, `could not connect — ${why(err)}`);
      }
    }

    const unsubscribe = subscribeStream((next) => {
      if (disposed) return;
      if (next) {
        if (current === null) void connect(next);
        return;
      }
      // Null before anything opened is "not up yet", not "stopped".
      if (!opened) return;
      // A real stop: close the call where the drive ends, and nothing reconnects.
      disposed = true;
      if (current) close(current);
      current = null;
      live.current = null;
      titlerRef.current?.close();
    });

    return () => {
      disposed = true;
      unsubscribe();
      if (current) close(current);
      current = null;
      live.current = null;
      titlerRef.current?.close();
      titlerRef.current = null;
      recordsRef.current = null;
    };
  }, [enabled, captureSessionId, patch, fire]);

  /* THE FLOOR, kept in step with the person's choice: the session creates no
   * reply while locked, and the state says what it confirmed. */
  const connected = state.status === "listening" || state.status === "speaking";
  useEffect(() => {
    const c = live.current;
    if (!connected || !c || c.appliedFloor === floor) return;
    applyTurnDetection(c, floor, latest.current.paused === true);
  }, [connected, floor]);

  /* THE DISPLAY STUDY'S PAUSE: nothing they say reaches the agent (the track
   * is taken off the sender, not disabled, so the recorder keeps writing),
   * anything it is saying stops, and no reply is created until it ends. */
  useEffect(() => {
    const c = live.current;
    if (!connected || !c || c.wasPaused === paused) return;
    void c.sender.replaceTrack(paused ? null : c.track).catch((err) => {
      console.warn(`[talkback:realtime] pause not applied — ${why(err)}`);
    });
    if (paused) {
      c.armed = null;
      if (c.conversation.responding) send(c, { type: "response.cancel" });
      if (c.conversation.speaking) send(c, { type: "output_audio_buffer.clear" });
      send(c, { type: "input_audio_buffer.clear" });
    } else {
      send(c, systemNote(REALTIME_RESUME_NOTE));
    }
    c.wasPaused = paused;
    applyTurnDetection(c, latest.current.floor, paused);
  }, [connected, paused]);

  const poke = useCallback(
    async (spark?: SparkRequest): Promise<PokeResult | null> => {
      const c = live.current;
      if (!c || c.dc.readyState !== "open" || latest.current.paused) return null;
      recordsRef.current?.floor("poke");
      if (c.conversation.speaking) return "speaking";
      if (c.conversation.responding) return "running";
      if (c.userSpeaking) {
        c.armed = spark ?? "poke";
        return "armed";
      }
      fire(c, spark ?? null);
      return "fired";
    },
    [fire],
  );

  // Kept, as the Pipecat hook keeps them; this engine has no per-turn context
  // to list them in, so a spark is pulled with a tap, not asked for aloud.
  const offered = useRef<readonly SparkRequest[]>([]);
  const offerSparks = useCallback((sparks: readonly SparkRequest[]) => {
    offered.current = sparks;
  }, []);

  const renameSubject = useCallback((ordinal: number, title: string) => {
    titlerRef.current?.rename(ordinal, title);
  }, []);

  if (!enabled || !captureSessionId) return { state: OFF, poke, offerSparks, renameSubject };
  return { state, poke, offerSparks, renameSubject };
}
