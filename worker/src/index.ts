#!/usr/bin/env node
/**
 * Entry point: wires together every stage of the pipeline in order --
 *   1. Read + validate the URL from the command line.
 *   2. Detect the platform (Instagram or TikTok).
 *   3. Use Apify to resolve a direct MP4 URL.
 *   4. Download that MP4 to a temporary local file.
 *   5. Sample frames and ask Claude for a structured analysis.
 *   6. Print the result.
 *   7. Always delete the temporary file, whether we succeeded or not.
 *
 * Note on imports: most modules here are statically imported as usual.
 * config.ts, apify/index.ts, and claude/index.ts are the exception -- they
 * read environment variables (config.ts directly; the other two via the
 * Apify/Anthropic clients they construct) and validation happens the moment
 * those modules are evaluated. Importing them dynamically, inside main()'s
 * own try/catch, means a missing API key produces the clean error message
 * this program prints below instead of a raw, unhandled stack trace.
 */
import { randomUUID } from "node:crypto";
import { logger } from "./utils/logger.js";
import { InvalidUsageError, isAppError } from "./utils/errors.js";
import { detectPlatform } from "./platform.js";
import { downloadVideo } from "./video/downloadVideo.js";
import { validateVideo } from "./video/validateVideo.js";
import { cleanupVideo } from "./video/cleanupVideo.js";

const USAGE_MESSAGE =
  'Usage: npm run analyze -- "<Instagram or TikTok URL>"\n' +
  '  Example: npm run analyze -- "https://www.instagram.com/reel/EXAMPLE/"\n' +
  '  Example: npm run analyze -- "https://www.tiktok.com/@username/video/123456789"';

/* --- State tracked so a Ctrl+C (SIGINT) or SIGTERM can still clean up --- */
let currentTempFilePath: string | null = null;
let currentDownloadDirectory = "downloads";
let isShuttingDown = false;

async function handleShutdownSignal(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warn(`Received ${signal}. Cleaning up before exit...`);
  if (currentTempFilePath) {
    await cleanupVideo(currentTempFilePath, currentDownloadDirectory);
  }

  // Exiting explicitly here is the one deliberate exception to "avoid
  // process.exit()": on a user-requested interrupt there is no further
  // program logic to run, and without this call Node may keep waiting on
  // in-flight network handles instead of actually terminating.
  process.exit(130);
}

process.on("SIGINT", () => {
  void handleShutdownSignal("SIGINT");
});
process.on("SIGTERM", () => {
  void handleShutdownSignal("SIGTERM");
});

async function main(): Promise<void> {
  logger.plain("Blendit Video Analyzer");
  logger.plain("");

  // Loading config runs Zod validation over every required environment
  // variable. Doing this first means a missing APIFY_API_TOKEN or
  // ANTHROPIC_API_KEY is reported before we even look at the URL argument.
  const { config } = await import("./config.js");
  currentDownloadDirectory = config.DOWNLOAD_DIRECTORY;

  const rawUrl = process.argv[2];
  if (!rawUrl) {
    throw new InvalidUsageError(`No URL was provided.\n\n${USAGE_MESSAGE}`);
  }

  const { platform } = detectPlatform(rawUrl);
  const platformLabel = platform === "instagram" ? "Instagram" : "TikTok";
  logger.plain(`Platform detected: ${platformLabel}`);

  const { retrieveVideo } = await import("./apify/index.js");
  const { analyzeSocialPhotoPost, analyzeSocialVideo } = await import("./claude/index.js");

  logger.info("Starting Apify downloader...");
  const retrieved = await retrieveVideo(rawUrl, platform);
  logger.success("Post retrieved.");
  if (retrieved.apifyRunId) {
    logger.info(`Apify run ID: ${retrieved.apifyRunId}`);
  }

  let analysis;
  if (retrieved.videoUrl) {
    logger.info("Downloading temporary MP4...");
    const downloaded = await downloadVideo({
      videoUrl: retrieved.videoUrl,
      downloadDirectory: config.DOWNLOAD_DIRECTORY,
      maxSizeMb: config.MAX_VIDEO_SIZE_MB,
    });
    currentTempFilePath = downloaded.filePath;

    await validateVideo(downloaded.filePath, config.MAX_VIDEO_SIZE_MB);
    const sizeMb = downloaded.sizeBytes / (1024 * 1024);
    logger.success("Video downloaded successfully.");
    logger.info(`Downloaded file size: ${sizeMb.toFixed(1)} MB`);

    try {
      analysis = await analyzeSocialVideo(downloaded.filePath, retrieved.caption, randomUUID());
    } finally {
      // Runs whether analysis succeeded, failed, or timed out -- the temp
      // video must never be left behind on disk.
      await cleanupVideo(downloaded.filePath, config.DOWNLOAD_DIRECTORY);
      currentTempFilePath = null;
    }
  } else {
    const imageUrls = retrieved.slideImageUrls ?? (retrieved.thumbnailUrl ? [retrieved.thumbnailUrl] : []);
    logger.info(`Photo/slideshow post detected -- no video track. Analyzing ${imageUrls.length} slide image(s) + caption.`);
    analysis = await analyzeSocialPhotoPost(imageUrls, retrieved.caption, randomUUID());
  }

  logger.plain("");
  logger.plain(`Title: ${analysis.title}`);
  logger.plain("");
  logger.plain("Summary:");
  logger.plain(analysis.summary);
  logger.plain("");
  if (analysis.locations.length > 0) {
    logger.plain("Locations:");
    for (const place of analysis.locations) {
      const detail = [place.category, place.address].filter(Boolean).join(" -- ");
      logger.plain(`  - ${place.name}${detail ? ` (${detail})` : ""}`);
    }
  } else {
    logger.plain("Locations: none identified");
  }

  logger.plain("");
  logger.success("Processing completed successfully.");
}

main().catch((err: unknown) => {
  if (isAppError(err)) {
    logger.error(err.message);
  } else {
    logger.error("An unexpected error occurred.");
  }

  // Full technical detail (stack traces, underlying SDK errors) is only
  // ever printed in development mode, so a production run never leaks
  // more than the concise, already-sanitized message above.
  if (process.env.NODE_ENV === "development") {
    logger.plain("");
    logger.plain(err instanceof Error && err.stack ? err.stack : String(err));
  }

  process.exitCode = 1;
});
