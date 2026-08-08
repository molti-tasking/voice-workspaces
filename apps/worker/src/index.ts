// Must run before anything reads process.env. In production Coolify injects
// these directly and the file simply will not exist.
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { PgBoss, type Job, type JobResult } from "pg-boss";
import { closeDb } from "@voicemural/db";
import { JOBS } from "@voicemural/shared";
import { log } from "./logger";
import {
  findUntranscribedChunks,
  handleTranscribeChunk,
} from "./jobs/transcribe-chunk";
import {
  closeIdleSessions,
  discardTranscribedAudio,
  requeueStuckChunks,
} from "./jobs/sweep";
import { BATCH_SIZE, extractWorkspace } from "./jobs/extract-workspace";
import { usersWithPendingSpeech } from "@voicemural/db/workspace";
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

async function main() {
  const boss = new PgBoss({
    connectionString: DATABASE_URL,
    schema: "pgboss",
  });

  boss.on("error", (err: unknown) => log.error("pg-boss error", { err: String(err) }));

  await boss.start();

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
    JOBS.transcribeChunk,
    {
      batchSize: TRANSCRIBE_CONCURRENCY,
      // Settle each job on its own. Without this, throwing for one bad chunk
      // fails the entire batch, so chunks that transcribed perfectly well would
      // be retried alongside it — wasted LiteLLM calls on every retry round.
      perJobResults: true,
    },
    async (jobs: Job<TranscribePayload>[]): Promise<JobResult[]> =>
      Promise.all(
        jobs.map(async (job): Promise<JobResult> => {
          try {
            await handleTranscribeChunk(job.data.chunkId);
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
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await requeueStuckChunks();
      await closeIdleSessions();
      await discardTranscribedAudio();

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
    } catch (err) {
      log.error("sweep failed", {
        err: err instanceof Error ? err.message : String(err),
      });
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
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.error("worker failed to start", {
    err: err instanceof Error ? err.stack : String(err),
  });
  process.exit(1);
});
