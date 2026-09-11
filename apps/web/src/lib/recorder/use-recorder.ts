"use client";

import { useRouter } from "next/navigation";
import { capture } from "@/lib/analytics/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearOpenSession,
  deleteRegistration,
  enqueueChunk,
  findOpenSession,
  saveOpenSession,
  saveRegistration,
  type OpenSessionMeta,
} from "./idb";
import { publishStream } from "./mic-bus";
import type { CaptureSetting } from "@voicemural/shared";
import { installUploaderTriggers, kickUploader, subscribeUploader } from "./uploader";

/**
 * Chunk length. Every chunk is a complete, independently decodable audio file
 * (see `recordChunk`), which costs a few milliseconds of audio at each
 * boundary. Longer chunks mean fewer boundaries and less loss; shorter chunks
 * mean lower transcription latency. 10s is the compromise — raise it if
 * coverage gaps show up in the Workspace, lower it if interview mode drags.
 */
const CHUNK_MS = 10_000;

/** ~32 kbps Opus is comfortably enough for speech: about 14 MB per hour. */
const AUDIO_BITS_PER_SECOND = 32_000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, Android
  "audio/webm",
  "audio/mp4", // Safari, including iOS
  "audio/ogg;codecs=opus", // Firefox
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopping";

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  error: string | null;
  wakeLockActive: boolean;
  pendingUploads: number;
  uploading: boolean;
  lastUploadError: string | null;
  resumable: OpenSessionMeta | null;
  /**
   * The drive currently being recorded, or null.
   *
   * Distinct from `lastSessionId`, which only appears after stopping: talk-back
   * needs to know which session it is conversing within *while* it runs.
   */
  currentSessionId: string | null;
  /** The session just finished, so the UI can link straight to its transcript. */
  lastSessionId: string | null;
  /** Recorded length of that session, for the confirmation line. */
  lastSessionMs: number;
}

/**
 * Record one chunk as a self-contained file.
 *
 * `MediaRecorder.start(timeslice)` would be the obvious approach, but only the
 * FIRST blob it emits carries the container header — later blobs are bare
 * fragments that no decoder will read on their own. Since each chunk is
 * transcribed independently, that would silently break the pipeline.
 *
 * Recycling the recorder per chunk against the same MediaStream gives a valid
 * file every time. The stream stays open, so there is no permission re-prompt;
 * the cost is a few milliseconds of audio lost at each boundary, which is why
 * `findCoverageGaps` tolerates sub-250ms discontinuities.
 */
function recordChunk(
  stream: MediaStream,
  mimeType: string,
  durationMs: number,
  registerStopper: (stop: () => void) => void,
): Promise<{ blob: Blob; durationMs: number }> {
  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const parts: BlobPart[] = [];
    let startedAt = 0;
    let settled = false;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) parts.push(event.data);
    };

    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        blob: new Blob(parts, { type: mimeType }),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    };

    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("MediaRecorder failed — the browser may have suspended capture"));
    };

    const stopNow = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };

    recorder.start();
    startedAt = performance.now();
    const timer = setTimeout(stopNow, durationMs);
    registerStopper(stopNow);
  });
}

export function useRecorder() {
  const router = useRouter();
  const [state, setState] = useState<RecorderState>({
    status: "idle",
    elapsedMs: 0,
    error: null,
    wakeLockActive: false,
    pendingUploads: 0,
    uploading: false,
    lastUploadError: null,
    resumable: null,
    currentSessionId: null,
    lastSessionId: null,
    lastSessionMs: 0,
  });

  const runningRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const stopChunkRef = useRef<(() => void) | null>(null);
  const metaRef = useRef<OpenSessionMeta | null>(null);

  /* Mirrors of state for the analytics events in start()/stop(). Those
   * callbacks have stable dependency arrays on purpose (their other deps are
   * all stable), so reading `state` inside them would capture the
   * first-render value — `resumed` would always be false and `chunks_pending`
   * always zero. Refs are the live view those events actually mean. */
  const resumableRef = useRef<OpenSessionMeta | null>(null);
  const pendingUploadsRef = useRef(0);

  const patch = useCallback((next: Partial<RecorderState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  /* --- Wake Lock ---------------------------------------------------------
   * iOS Safari suspends capture the moment the screen locks, so the lock is
   * not a nicety — it is what makes an eyes-free drive recordable at all.
   * It is also dropped whenever the tab is backgrounded, hence the re-acquire.
   */
  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      patch({ wakeLockActive: true });
      wakeLockRef.current.addEventListener("release", () => {
        patch({ wakeLockActive: false });
      });
    } catch {
      // Denied or unsupported — recording still works while the tab is visible,
      // but on iOS a screen lock ends capture, so this is a leading indicator
      // of a truncated drive rather than a cosmetic failure.
      capture("wake_lock_denied", {});
      patch({ wakeLockActive: false });
    }
  }, [patch]);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* already released */
    }
    wakeLockRef.current = null;
    patch({ wakeLockActive: false });
  }, [patch]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && runningRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  /* --- Uploader wiring --------------------------------------------------- */
  useEffect(() => {
    const teardown = installUploaderTriggers();
    const unsubscribe = subscribeUploader((s) => {
      pendingUploadsRef.current = s.pending;
      patch({
        pendingUploads: s.pending,
        uploading: s.uploading,
        lastUploadError: s.lastError,
      });
    });
    return () => {
      teardown();
      unsubscribe();
    };
  }, [patch]);

  /* --- Recovery ----------------------------------------------------------- */
  useEffect(() => {
    void findOpenSession().then((open) => {
      if (!open) return;
      resumableRef.current = open;
      patch({ resumable: open });
      capture("unfinished_session_detected", { capture_session_id: open.captureSessionId });
    });
  }, [patch]);

  /* --- Chunk loop --------------------------------------------------------- */
  const runLoop = useCallback(
    async (stream: MediaStream, meta: OpenSessionMeta) => {
      while (runningRef.current) {
        let chunk: { blob: Blob; durationMs: number };
        try {
          chunk = await recordChunk(stream, meta.mimeType, CHUNK_MS, (stop) => {
            stopChunkRef.current = stop;
          });
        } catch (err) {
          patch({ error: err instanceof Error ? err.message : String(err) });
          runningRef.current = false;

          // Tear the recording down exactly as stop() would. Without this the
          // failure wedges the UI: stop() no-ops once runningRef is false, so
          // the mic would stay open, the wake lock held and the status stuck
          // on "recording" until a page reload. The anticipated cause of this
          // error is iOS suspending capture on screen lock — the one
          // interruption a drive is most likely to hit.
          publishStream(null);
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          void releaseWakeLock();
          try {
            await fetch(`/api/capture-sessions/${meta.captureSessionId}/end`, {
              method: "POST",
            });
          } catch {
            // Best-effort. The worker's sweep closes sessions that go quiet.
          }
          await clearOpenSession(meta.captureSessionId);
          metaRef.current = null;
          patch({
            status: "idle",
            currentSessionId: null,
            lastSessionId: meta.captureSessionId,
            lastSessionMs: meta.elapsedMs,
          });
          kickUploader();
          router.refresh();
          break;
        }

        if (chunk.blob.size > 0) {
          // Offsets come from the running elapsed counter, never from upload
          // time — chunks buffered offline can arrive minutes late and out of
          // order, and provenance depends on these staying monotonic.
          await enqueueChunk({
            captureSessionId: meta.captureSessionId,
            seq: meta.nextSeq,
            startOffsetMs: meta.elapsedMs,
            durationMs: chunk.durationMs,
            mimeType: meta.mimeType,
            blob: chunk.blob,
            attempts: 0,
            createdAt: Date.now(),
          });

          meta.nextSeq += 1;
          meta.elapsedMs += chunk.durationMs;
          metaRef.current = meta;
          await saveOpenSession(meta);
          patch({ elapsedMs: meta.elapsedMs });
          kickUploader();
        }
      }
    },
    [patch, releaseWakeLock, router],
  );

  /**
   * Begin recording.
   *
   * `setting` is where the person is, as detected or corrected. It reaches the
   * server once, at session creation, and is immutable thereafter: it governs
   * turn-taking and how much may go on screen, so a recording whose second
   * half ran under different rules would not be interpretable. Omitted when
   * nothing could be inferred, which the server reads as the historical default.
   *
   * `voiceId` is the voice the system will speak with, from the catalogue in
   * `@voicemural/talkback/voice`. Same lifecycle: stated once, stored on the
   * session, immutable for the drive.
   *
   * `sttLanguage` is the language BOTH transcription paths will use, from
   * `@voicemural/talkback/language`. Null — the default — means auto-detect.
   * Same lifecycle again, and for the same reason: a drive whose second half
   * was transcribed under a different assumption is not interpretable.
   */
  const start = useCallback(async (
    setting?: CaptureSetting,
    source?: "device" | "motion" | "default" | "chosen",
    voiceId?: string,
    sttLanguage?: string | null,
  ) => {
    if (runningRef.current) return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      patch({ error: "This browser cannot record audio (no supported MediaRecorder format)." });
      return;
    }

    patch({ status: "requesting", error: null });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      capture("mic_permission_denied", {
        error_name: err instanceof Error ? err.name : "Unknown",
      });
      patch({
        status: "idle",
        error:
          err instanceof Error && err.name === "NotAllowedError"
            ? "Microphone permission denied."
            : "Could not open the microphone.",
      });
      return;
    }

    streamRef.current = stream;
    // Share the track with talk-back, which taps it for the live conversation.
    // Nothing downstream of this is allowed to affect capture: if no one is
    // listening, or a listener throws, the chunk loop below is unchanged.
    publishStream(stream);
    capture("recording_started", {
      mime_type: mimeType,
      resumed: resumableRef.current !== null,
      // Read after the request settles; false here predicts a drive that ends
      // when the screen locks.
      wake_lock_active: wakeLockRef.current !== null,
      setting: setting ?? null,
      setting_source: source ?? null,
      voice_id: voiceId ?? null,
      stt_language: sttLanguage ?? null,
    });

    const meta: OpenSessionMeta = {
      captureSessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      nextSeq: 0,
      elapsedMs: 0,
      mimeType,
      serverAcked: false,
    };
    metaRef.current = meta;
    await saveOpenSession(meta);

    // Register the session server-side. If this fails we still record — chunks
    // queue locally and the session can be registered when signal returns.
    // Refusing to record because the network is down would be exactly backwards.
    //
    // The registration body is saved durably BEFORE the attempt, so a drive
    // that starts offline can be registered later by the uploader when a chunk
    // comes back `session_not_found` — without it, those chunks would be
    // rejected permanently and the whole drive lost. Deleted once the server
    // has acknowledged the row exists.
    const registration = {
      id: meta.captureSessionId,
      startedAt: new Date(meta.startedAt).toISOString(),
      deviceInfo: { userAgent: navigator.userAgent, mimeType },
      setting,
      voiceId,
      // Null is normal (auto-detect); undefined on the wire keeps zod happy.
      sttLanguage: sttLanguage ?? undefined,
    };
    await saveRegistration(registration);

    try {
      const res = await fetch("/api/capture-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration),
      });
      meta.serverAcked = res.ok;
      await saveOpenSession(meta);
      if (res.ok) await deleteRegistration(meta.captureSessionId);
    } catch {
      meta.serverAcked = false;
    }

    runningRef.current = true;
    resumableRef.current = null;
    patch({
      status: "recording",
      elapsedMs: 0,
      resumable: null,
      currentSessionId: meta.captureSessionId,
      lastSessionId: null,
    });
    await acquireWakeLock();
    void runLoop(stream, meta);
  }, [acquireWakeLock, patch, runLoop]);

  const stop = useCallback(async () => {
    if (!runningRef.current) return;

    patch({ status: "stopping" });
    runningRef.current = false;

    // End the in-flight chunk so its audio is kept rather than discarded.
    stopChunkRef.current?.();
    stopChunkRef.current = null;

    // Before stopping the tracks, so talk-back tears its tap down against a
    // stream that is still live rather than one already ending under it.
    publishStream(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    await releaseWakeLock();

    const meta = metaRef.current;
    if (meta) {
      capture("recording_stopped", {
        capture_session_id: meta.captureSessionId,
        recording_duration_ms: meta.elapsedMs,
        chunks_recorded: meta.nextSeq,
        // Anything still queued here is what a dead zone is holding. It rides
        // the durable upload queue, not posthog-js, so it is still reported
        // even if this event never leaves the phone.
        chunks_pending: pendingUploadsRef.current,
      });
      try {
        await fetch(`/api/capture-sessions/${meta.captureSessionId}/end`, {
          method: "POST",
        });
      } catch {
        // Best-effort. The worker's sweep closes sessions that go quiet, so a
        // failed call here never strands a session.
      }
      await clearOpenSession(meta.captureSessionId);
    }

    metaRef.current = null;
    // Hold on to what was just recorded so the UI can offer a direct link to
    // its transcript. Ending a drive and landing on an undifferentiated list
    // gives no sense that anything was captured at all.
    patch({
      status: "idle",
      currentSessionId: null,
      lastSessionId: meta?.captureSessionId ?? null,
      lastSessionMs: meta?.elapsedMs ?? 0,
    });
    kickUploader();

    // The Workspace is a server component and Next caches RSC payloads for
    // client navigations, so without this the sessions list renders the copy
    // fetched before this recording existed — and the drive looks lost.
    router.refresh();
  }, [patch, releaseWakeLock, router]);

  /** Discard a recovered session's marker. Queued chunks still upload. */
  const dismissResumable = useCallback(async () => {
    const open = state.resumable;
    if (!open) return;
    try {
      await fetch(`/api/capture-sessions/${open.captureSessionId}/end`, { method: "POST" });
    } catch {
      /* best-effort */
    }
    await clearOpenSession(open.captureSessionId);
    resumableRef.current = null;
    capture("unfinished_session_closed", { capture_session_id: open.captureSessionId });
    patch({ resumable: null });
    kickUploader();
  }, [patch, state.resumable]);

  return { ...state, start, stop, dismissResumable, chunkMs: CHUNK_MS };
}
