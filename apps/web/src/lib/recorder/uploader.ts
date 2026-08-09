import { capture } from "@/lib/analytics/client";
import {
  deleteChunk,
  markAttempt,
  pendingChunks,
  pendingCount,
  type PendingChunk,
} from "./idb";

/**
 * Drains the IndexedDB queue to the server.
 *
 * Runs as a single loop regardless of how many times it is kicked, so a burst
 * of `online` events plus per-chunk kicks cannot start parallel drains that
 * upload the same chunk twice.
 *
 * A chunk is deleted locally only after the server acknowledges it. The server
 * treats a repeated seq as a duplicate and returns 200, so an ack lost to a
 * timeout costs one redundant upload rather than a lost recording.
 */

export interface UploaderStatus {
  pending: number;
  uploading: boolean;
  lastError: string | null;
  lastSuccessAt: number | null;
}

type Listener = (status: UploaderStatus) => void;

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

let draining = false;
let queuedKick = false;
const listeners = new Set<Listener>();

const status: UploaderStatus = {
  pending: 0,
  uploading: false,
  lastError: null,
  lastSuccessAt: null,
};

export function subscribeUploader(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...status });
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) l({ ...status });
}

async function refreshPending() {
  try {
    status.pending = await pendingCount();
  } catch {
    /* count is advisory only */
  }
}

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadOne(chunk: PendingChunk): Promise<"ok" | "retry" | "drop"> {
  const form = new FormData();
  form.append("audio", chunk.blob, `${chunk.seq}.bin`);
  form.append("seq", String(chunk.seq));
  form.append("startOffsetMs", String(chunk.startOffsetMs));
  form.append("durationMs", String(chunk.durationMs));
  form.append("mimeType", chunk.mimeType);

  const res = await fetch(`/api/capture-sessions/${chunk.captureSessionId}/chunks`, {
    method: "POST",
    body: form,
    // The queue is the retry mechanism; don't let the browser cache anything.
    cache: "no-store",
  });

  if (res.ok) return "ok";

  // 4xx means this chunk will never be accepted as-is. Retrying forever would
  // wedge the queue behind it and block every later chunk, so drop it and keep
  // the rest of the drive. 401 is the exception: the user can sign back in.
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408) {
    const body = await res.text().catch(() => "");
    console.error(`Dropping chunk ${chunk.seq}: server rejected it with ${res.status}`, body);
    // Every one of these is a permanently lost piece of a recording, and the
    // console.error above is the only trace it has ever left. Reported so the
    // loss is visible as a number rather than a puzzled participant.
    capture("upload_chunk_dropped", {
      status: res.status,
      seq: chunk.seq,
      error_code: errorCodeFrom(body),
    });
    return "drop";
  }

  return "retry";
}

/** The `error` field of the API's JSON error envelope, when there is one. */
function errorCodeFrom(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const code = (parsed as { error: unknown }).error;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** Kick the drain loop. Safe to call as often as you like. */
export function kickUploader(): void {
  if (draining) {
    queuedKick = true;
    return;
  }
  void drain();
}

async function drain(): Promise<void> {
  draining = true;
  status.uploading = true;
  emit();

  // Reported once per drain rather than per chunk. Per-chunk would be six
  // near-identical events a minute; per-session would average away the very
  // thing worth measuring. Per-drain gives the distribution of how long a
  // phone spends unable to reach the server, which for a study conducted in a
  // moving car is a finding rather than an operational metric.
  let flushed = 0;
  let dropped = 0;
  let oldestChunkAgeMs = 0;

  try {
    do {
      queuedKick = false;

      for (;;) {
        if (typeof navigator !== "undefined" && !navigator.onLine) break;

        const batch = await pendingChunks(10);
        if (batch.length === 0) break;

        // The head of the queue is the oldest thing still unsent, so its age is
        // how far behind the dead zone has pushed us.
        const head = batch[0];
        if (head?.createdAt) {
          oldestChunkAgeMs = Math.max(oldestChunkAgeMs, Date.now() - head.createdAt);
        }

        let progressed = false;

        for (const chunk of batch) {
          if (chunk.localId === undefined) continue;

          let outcome: "ok" | "retry" | "drop";
          try {
            outcome = await uploadOne(chunk);
          } catch (err) {
            // Network failure — almost certainly a dead zone.
            status.lastError = err instanceof Error ? err.message : String(err);
            outcome = "retry";
          }

          if (outcome === "ok" || outcome === "drop") {
            await deleteChunk(chunk.localId);
            if (outcome === "ok") {
              status.lastSuccessAt = Date.now();
              status.lastError = null;
              flushed += 1;
            } else {
              dropped += 1;
            }
            progressed = true;
          } else {
            await markAttempt(chunk);
            await refreshPending();
            emit();
            // Head-of-line wait: chunks upload in capture order, and there is
            // no point racing ahead while the network is down.
            await sleep(backoffFor(chunk.attempts));
            progressed = false;
            break;
          }
        }

        await refreshPending();
        emit();

        if (!progressed) break;
      }
    } while (queuedKick);
  } finally {
    draining = false;
    status.uploading = false;
    await refreshPending();
    emit();

    if (flushed > 0 || dropped > 0) {
      capture("upload_drained", {
        chunks_flushed: flushed,
        oldest_chunk_age_ms: oldestChunkAgeMs,
        dropped,
      });
    }
  }
}

/** Resume draining as soon as the network returns. */
export function installUploaderTriggers(): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => kickUploader();
  const onVisible = () => {
    if (document.visibilityState === "visible") kickUploader();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void refreshPending().then(emit);
  kickUploader();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
