/**
 * Deletes the temporary local MP4. This is always called from a `finally`
 * block in src/index.ts so it runs whether the pipeline succeeded, failed,
 * or timed out. It never throws -- a cleanup failure must not hide or
 * replace the "real" error (or a successful summary) that already happened.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export async function cleanupVideo(filePath: string, downloadDirectory: string): Promise<void> {
  const resolvedFile = path.resolve(filePath);
  const resolvedDir = path.resolve(downloadDirectory);

  // Safety net: never let this function delete anything outside the
  // configured downloads directory, even if it were ever called with an
  // unexpected path.
  if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(resolvedDir + path.sep)) {
    logger.warn(`Refused to delete a file outside the downloads directory: ${resolvedFile}`);
    return;
  }

  try {
    await rm(resolvedFile, { force: true });
    logger.success("Temporary video deleted.");
  } catch (err) {
    logger.warn(`Could not delete temporary video file (${(err as Error).message}). You may remove it manually.`);
  }
}
