/**
 * Deletes a job's sampled-frame directory. Mirrors cleanupVideo.ts's safety
 * check (never delete outside the configured downloads directory) and its
 * "never throw" contract -- called from a `finally` block, so a cleanup
 * failure must never hide the real result (or error) that already happened.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

export async function cleanupFrames(frameDir: string): Promise<void> {
  const resolvedDir = path.resolve(frameDir);
  const resolvedDownloadsRoot = path.resolve(config.DOWNLOAD_DIRECTORY);

  if (resolvedDir !== resolvedDownloadsRoot && !resolvedDir.startsWith(resolvedDownloadsRoot + path.sep)) {
    logger.warn(`Refused to delete a directory outside the downloads directory: ${resolvedDir}`);
    return;
  }

  try {
    await rm(resolvedDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`Could not delete temporary frame directory (${(err as Error).message}). You may remove it manually.`);
  }
}
