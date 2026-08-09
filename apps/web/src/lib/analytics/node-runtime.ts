import { captureServerException, shutdownAnalytics } from "./server";

/**
 * Process-level analytics wiring for the Node server.
 *
 * Split out of `instrumentation.ts` and reached only through a dynamic import
 * so the edge bundle never contains it. Next statically analyses
 * `instrumentation.ts` for both runtimes and does not follow the
 * `NEXT_RUNTIME` guard, so `process.once` written there is reported as an
 * unsupported Edge API on every build.
 */
let installed = false;

export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;

  const flush = (signal: string) => {
    void shutdownAnalytics().finally(() => {
      // No process.exit: Next owns shutdown, and exiting here would cut off an
      // in-flight response.
      console.log(`Flushed analytics on ${signal}`);
    });
  };

  // Coolify sends SIGTERM on every redeploy. The client batches, so without
  // this the last few seconds of events are dropped each time — which reads
  // afterwards as a small dip in traffic rather than as lost data.
  process.once("SIGTERM", () => flush("SIGTERM"));
  process.once("SIGINT", () => flush("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    captureServerException(reason);
  });
}
