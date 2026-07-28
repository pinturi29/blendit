#!/usr/bin/env node
/**
 * Queue worker entry point (`npm run worker`): runs WORKER_CONCURRENCY
 * independent lanes, each claiming and processing one trip_clips row at a
 * time through processJob.ts, forever. This is a separate long-running
 * process from the single-URL CLI (src/index.ts) -- it's meant to be
 * started once and left running (on your machine during development, later
 * on a small always-on host) so the app can queue clips without waiting on
 * them.
 *
 * Running N lanes concurrently -- rather than one loop processing jobs
 * strictly one after another -- is what lets several clips submitted
 * around the same time clear in parallel instead of queueing behind each
 * other. This is safe by construction: claim_next_clip_job() (see the 0012
 * migration) uses `FOR UPDATE SKIP LOCKED`, so N lanes calling it at the
 * same moment can never claim the same row.
 *
 * Config, Supabase, and processJob are imported dynamically inside main()'s
 * try/catch for the same reason src/index.ts does it: a missing API key or
 * Supabase credential should produce this program's own clean error
 * message, not a raw unhandled stack trace at module-load time.
 */
import { logger } from "./utils/logger.js";
import { isAppError } from "./utils/errors.js";
import { sleep } from "./utils/sleep.js";

let isShuttingDown = false;
process.on("SIGINT", () => {
  logger.warn("Received SIGINT. Finishing the current job (if any), then exiting...");
  isShuttingDown = true;
});
process.on("SIGTERM", () => {
  logger.warn("Received SIGTERM. Finishing the current job (if any), then exiting...");
  isShuttingDown = true;
});

async function main(): Promise<void> {
  logger.plain("Blendit video extraction worker");
  logger.plain("");

  const { config } = await import("./config.js");
  const { supabase } = await import("./supabase/client.js");
  const { processJob } = await import("./queue/processJob.js");
  const { processItineraryJob } = await import("./queue/processItineraryJob.js");

  // Crash recovery: a job left "processing" past this timeout almost
  // certainly means a previous worker run died mid-job, not that it's
  // still legitimately working -- put it back in the queue.
  const { data: reclaimed, error: reclaimError } = await supabase
    .from("trip_clips")
    .update({ status: "pending", processing_started_at: null })
    .eq("status", "processing")
    .lt("processing_started_at", new Date(Date.now() - config.WORKER_STALE_JOB_TIMEOUT_MS).toISOString())
    .select("id");
  if (reclaimError) {
    logger.warn(`Could not check for stale jobs: ${reclaimError.message}`);
  } else if (reclaimed && reclaimed.length > 0) {
    logger.warn(`Reclaimed ${reclaimed.length} stale job(s) left "processing" by a previous run.`);
  }

  const { data: reclaimedItineraries, error: reclaimItineraryError } = await supabase
    .from("trip_itineraries")
    .update({ status: "pending", processing_started_at: null })
    .eq("status", "processing")
    .lt("processing_started_at", new Date(Date.now() - config.WORKER_STALE_JOB_TIMEOUT_MS).toISOString())
    .select("id");
  if (reclaimItineraryError) {
    logger.warn(`Could not check for stale itinerary jobs: ${reclaimItineraryError.message}`);
  } else if (reclaimedItineraries && reclaimedItineraries.length > 0) {
    logger.warn(`Reclaimed ${reclaimedItineraries.length} stale itinerary job(s) left "processing" by a previous run.`);
  }

  logger.info(
    `Running ${config.WORKER_CONCURRENCY} lane(s), polling every ${config.WORKER_POLL_INTERVAL_MS / 1000}s when idle. Ctrl+C to stop.`,
  );

  async function runLane(laneId: number): Promise<void> {
    while (!isShuttingDown) {
      // claim_next_clip_job() is SETOF trip_clips -- zero rows means
      // nothing was pending, so `data` is `[]`, never a row of nulls (see
      // 0012's migration comment for why that distinction matters here).
      // FOR UPDATE SKIP LOCKED inside it is what makes it safe for every
      // lane to call this concurrently without ever claiming the same row.
      const { data: jobs, error } = await supabase.rpc("claim_next_clip_job");

      if (error) {
        logger.error(`[lane ${laneId}] Could not claim a job: ${error.message}`);
        await sleep(config.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      const job = jobs?.[0];
      // Belt and suspenders: even if the RPC ever again returned something
      // job-shaped but empty, never hand it to processJob -- that's exactly
      // how the last bug turned into a tight, no-delay failure loop.
      if (!job?.id) {
        await sleep(config.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      await processJob(job, laneId);
    }
  }

  // Itinerary generation is rare and lightweight compared to video
  // processing (a single text-only Claude call, no Apify/ffmpeg), so one
  // dedicated lane is enough -- no need for the same concurrency as clips.
  async function runItineraryLane(): Promise<void> {
    while (!isShuttingDown) {
      const { data: jobs, error } = await supabase.rpc("claim_next_itinerary_job");

      if (error) {
        logger.error(`[itinerary] Could not claim a job: ${error.message}`);
        await sleep(config.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      const job = jobs?.[0];
      if (!job?.id) {
        await sleep(config.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      await processItineraryJob(job);
    }
  }

  await Promise.all([
    ...Array.from({ length: config.WORKER_CONCURRENCY }, (_, i) => runLane(i + 1)),
    runItineraryLane(),
  ]);

  logger.plain("");
  logger.success("Worker stopped.");
}

main().catch((err: unknown) => {
  if (isAppError(err)) {
    logger.error(err.message);
  } else {
    logger.error("An unexpected error occurred.");
  }
  if (process.env.NODE_ENV === "development") {
    logger.plain("");
    logger.plain(err instanceof Error && err.stack ? err.stack : String(err));
  }
  process.exitCode = 1;
});
