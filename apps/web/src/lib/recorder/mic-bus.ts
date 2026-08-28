/**
 * The live microphone stream, published for anyone else who needs it.
 *
 * Talk-back needs the same audio the recorder is already capturing, and there
 * is exactly one correct way to get it: share the `MediaStream`. Calling
 * `getUserMedia` a second time can renegotiate the track, spin up a second echo
 * canceller, and on some Android builds visibly perturb the `MediaRecorder`
 * that is producing the verbatim ledger. One track feeding both a
 * `MediaRecorder` and a `MediaStreamAudioSourceNode` is fine and costs nothing.
 *
 * This module is deliberately trivial and deliberately one-directional:
 * `use-recorder` publishes, talk-back subscribes. The recorder must never learn
 * anything about talk-back, because capture cannot be allowed to depend on it.
 */

type Listener = (stream: MediaStream | null) => void;

let current: MediaStream | null = null;
const listeners = new Set<Listener>();

/** Called by the recorder when capture starts (a stream) and stops (null). */
export function publishStream(stream: MediaStream | null): void {
  current = stream;
  for (const listener of listeners) {
    try {
      listener(stream);
    } catch {
      // A subscriber that throws must not break the recorder's start/stop path.
    }
  }
}

/**
 * Subscribe to the live stream. Fires immediately with the current value, so a
 * subscriber that mounts mid-recording still gets attached.
 */
export function subscribeStream(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
