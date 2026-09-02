// Must run before anything reads process.env. In production Coolify injects
// these directly and the file simply will not exist.
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { PgBoss, type Job, type JobResult, type JobWithMetadata } from "pg-boss";
import { closeDb } from "@voicemural/db";
import { JOBS } from "@voicemural/shared";
import { log } from "@voicemural/telemetry";
import {
  findUntranscribedChunks,
  handleTranscribeChunk,
} from "./jobs/transcribe-chunk";
import {
  closeIdleSessions,
  discardTranscribedAudio,
  reportCompletedSessions,
  requeueStuckChunks,
} from "./jobs/sweep";
import { captureException, installGenerationSink, shutdownAnalytics } from "@voicemural/telemetry";
import { BATCH_SIZE, extractWorkspace } from "./jobs/extract-workspace";
import { classifyChunk } from "./jobs/classify-utterance";
import { invokePendingDirectives } from "./jobs/invoke-capability";
import { MACRO_WINDOW_DAYS, MIN_OCCURRENCES, detectMacros } from "./jobs/detect-macros";
import { usersWithPendingSpeech } from "@voicemural/db/workspace";
import {
  chunksWithUnclassifiedUtterances,
  usersWithUnresolvedDirectives,
} from "@voicemural/db/repertoire";
import { preflightLiteLLM } from "./preflight";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set.");

/** How often to look for work. Uploads arrive in bursts after a dead zone. */
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 5000);

/**
 * Transcription concurrency. Each job holds a chunk in memory and waits on
 * LiteLLM, so this is really a limit on how hard we lean on the proxy.
 */
const TRANSCRIBE_CONCURRENCY = Number(process.env.TRANSCRIBE_CONCURRENCY ?? 4);

interface TranscribePayload {
  chunkId: string;
}

/**
 * How often the macro detector runs, per worker process.
 *
 * Far rarer than the other sweeps because it is looking for a pattern that
 * takes days to form — three occurrences across two sessions — and because
 * each candidate costs a `reasoning` call. Running it every five seconds would
 * spend money to re-derive the same "not yet" over and over.
 */
const MACRO_INTERVAL_MS = Number(process.env.MACRO_INTERVAL_MS ?? 30 * 60 * 1000);

async function main() {
  const boss = new PgBoss({
    connectionString: DATABASE_URL,
    schema: "pgboss",
  });

  boss.on("error", (err: unknown) => log.error("pg-boss error", { err: String(err) }));

  await boss.start();

  // Bridge model calls made inside packages/llm into AI Observability. Set once
  // here rather than imported there, so the llm package stays free of a
  // posthog dependency that the web app would also have to compile.
  installGenerationSink();

  await boss.createQueue(JOBS.transcribeChunk, {
    // 60s, 120s, 240s — a ~7 minute window, deliberately shorter than the
    // 20-minute stuck threshold in sweep.ts so the two mechanisms never fight.
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    // Keep finished jobs around long enough to debug a bad drive.
    retentionSeconds: 60 * 60 * 24 * 3,
  });

  await boss.createQueue(JOBS.classifyUtterance, {
    // Cheap and idempotent — the write is guarded on `kind = 'unclassified'` —
    // so retries are safe and short.
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 60 * 60 * 24 * 3,
  });

  await boss.createQueue(JOBS.detectMacros, {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 900,
    retentionSeconds: 60 * 60 * 24 * 7,
  });

  await boss.createQueue(JOBS.workspaceExtract, {
    // A cold self-hosted reasoning model can take a minute to load, so give the
    // first attempt room before retrying.
    retryLimit: 3,
    retryDelay: 120,
    retryBackoff: true,
    expireInSeconds: 900,
    retentionSeconds: 60 * 60 * 24 * 3,
  });

  await boss.work(
    JOBS.workspaceExtract,
    // One at a time per worker: extraction reads the folded state and appends
    // to it, so two concurrent runs for the same user would each build on a
    // state the other is about to invalidate.
    { batchSize: 1 },
    async (jobs: Job<{ userId: string }>[]) => {
      for (const job of jobs) {
        await extractWorkspace(job.data.userId);
      }
    },
  );

  await boss.work(
    JOBS.classifyUtterance,
    // Several at once: most jobs make no model call at all, because the lexical
    // gate rejects almost every line before one is needed.
    { batchSize: 4, perJobResults: true },
    async (jobs: Job<{ chunkId: string; userId: string }>[]): Promise<JobResult[]> =>
      Promise.all(
        jobs.map(async (job): Promise<JobResult> => {
          try {
            await classifyChunk(job.data.chunkId, job.data.userId);
            return { id: job.id, status: "completed" };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error("classify job failed", { chunkId: job.data.chunkId, err: message });
            return { id: job.id, status: "failed", output: { message } };
          }
        }),
      ),
  );

  await boss.work(
    JOBS.detectMacros,
    { batchSize: 1 },
    async (jobs: Job<{ userId: string }>[]) => {
      for (const job of jobs) {
        await detectMacros(job.data.userId);
      }
    },
  );

  await boss.work(
    JOBS.transcribeChunk,
    {
      batchSize: TRANSCRIBE_CONCURRENCY,
      // Settle each job on its own. Without this, throwing for one bad chunk
      // fails the entire batch, so chunks that transcribed perfectly well would
      // be retried alongside it — wasted LiteLLM calls on every retry round.
      perJobResults: true,
      // For retryCount, which distinguishes three paid-for model calls from one
      // call reported three times in the cost figures.
      includeMetadata: true,
    },
    async (jobs: JobWithMetadata<TranscribePayload>[]): Promise<JobResult[]> =>
      Promise.all(
        jobs.map(async (job): Promise<JobResult> => {
          try {
            // pg-boss counts attempts from 1 on first delivery. Passing it down
            // is what separates "three calls were paid for" from "one call was
            // reported three times" in the cost figures.
            await handleTranscribeChunk(job.data.chunkId, job.retryCount + 1);
            return { id: job.id, status: "completed" };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error("transcribe job failed", {
              jobId: job.id,
              chunkId: job.data.chunkId,
              err: message,
            });
            return { id: job.id, status: "failed", output: { message } };
          }
        }),
      ),
  );

  log.info("worker started", {
    sweepIntervalMs: SWEEP_INTERVAL_MS,
    concurrency: TRANSCRIBE_CONCURRENCY,
  });

  await preflightLiteLLM();

  /**
   * The web app never enqueues anything — it only writes rows. This sweep is
   * the sole producer, which means a worker outage cannot lose work: chunks
   * simply accumulate as `stored` and are picked up on the next start. It also
   * absorbs the burst that arrives when a phone regains signal after a tunnel.
   */
  let sweeping = false;
  /* Starts at zero so the first sweep after a restart runs the detector. A
   * worker that has just come up is exactly when a backlog of directions is
   * most likely to be waiting. */
  let lastMacroSweepAt = 0;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await requeueStuckChunks();
      await closeIdleSessions();
      await discardTranscribedAudio();
      // After closeIdleSessions, so a session closed on this pass is a
      // candidate from here on; the 25-minute settle window inside means it
      // will not actually be reported for a while yet.
      await reportCompletedSessions();

      const chunkIds = await findUntranscribedChunks(50);
      for (const chunkId of chunkIds) {
        // singletonKey dedupes against a job already queued for this chunk, so
        // a fast sweep interval cannot pile up duplicates.
        await boss.send(JOBS.transcribeChunk, { chunkId }, { singletonKey: chunkId });
      }
      if (chunkIds.length > 0) log.info("queued chunks", { count: chunkIds.length });

      // Workspace extraction runs off the transcript, not the queue: whoever
      // has enough unconsumed speech gets a job. singletonKey per user keeps a
      // slow extraction from stacking up behind itself.
      const userIds = await usersWithPendingSpeech(BATCH_SIZE);
      for (const userId of userIds) {
        await boss.send(JOBS.workspaceExtract, { userId }, { singletonKey: userId });
      }
      if (userIds.length > 0) log.info("queued workspace extraction", { users: userIds.length });

      // The fast lane behind the secondary display. Per chunk, so a direction
      // lands ~15-25s after it was said rather than waiting for the next
      // extraction batch.
      const unclassified = await chunksWithUnclassifiedUtterances(50);
      for (const { chunkId, userId } of unclassified) {
        await boss.send(
          JOBS.classifyUtterance,
          { chunkId, userId },
          { singletonKey: chunkId },
        );
      }
      if (unclassified.length > 0) {
        log.info("queued classification", { chunks: unclassified.length });
      }

      // Directions that resolved to a capability but have no invocation yet.
      // Done inline rather than queued: it is a handful of indexed rows and a
      // couple of inserts, with no model call anywhere in it.
      const invoked = await invokePendingDirectives(50);
      if (invoked.fired > 0 || invoked.awaitingConfirmation > 0) {
        log.info("invocations", invoked as unknown as Record<string, unknown>);
      }

      if (Date.now() - lastMacroSweepAt >= MACRO_INTERVAL_MS) {
        lastMacroSweepAt = Date.now();
        const since = new Date(Date.now() - MACRO_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const candidates = await usersWithUnresolvedDirectives(since, MIN_OCCURRENCES);
        for (const userId of candidates) {
          await boss.send(JOBS.detectMacros, { userId }, { singletonKey: userId });
        }
        if (candidates.length > 0) {
          log.info("queued macro detection", { users: candidates.length });
        }
      }
    } catch (err) {
      log.error("sweep failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      captureException(err);
    } finally {
      sweeping = false;
    }
  };

  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  void sweep();

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    clearInterval(timer);
    try {
      await boss.stop();
    } catch (err) {
      log.error("error stopping pg-boss", { err: String(err) });
    }
    // Before closeDb, and before exit: the client batches, so without an
    // explicit flush a redeploy drops whatever the last sweep produced.
    await shutdownAnalytics();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", { err: String(reason) });
    captureException(reason);
  });
}

main().catch((err: unknown) => {
  log.error("worker failed to start", {
    err: err instanceof Error ? err.stack : String(err),
  });
  process.exit(1);
});
