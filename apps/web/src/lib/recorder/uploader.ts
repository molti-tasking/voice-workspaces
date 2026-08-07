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
    console.error(
      `Dropping chunk ${chunk.seq}: server rejected it with ${res.status}`,
      await res.text().catch(() => ""),
    );
    return "drop";
  }

  return "retry";
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

  try {
    do {
      queuedKick = false;

      for (;;) {
        if (typeof navigator !== "undefined" && !navigator.onLine) break;

        const batch = await pendingChunks(10);
        if (batch.length === 0) break;

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
