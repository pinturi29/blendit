/**
 * Barrel module for the Claude analysis stage. Two entry points depending
 * on whether the post has a video track:
 *   - analyzeSocialVideo: sample frames -> analyze -> keep one frame as a
 *     thumbnail -> clean up the rest -> return the result.
 *   - analyzeSocialPhotoPost: for photo/slideshow posts (no video at all,
 *     e.g. a TikTok photo post or an Instagram carousel) -- analyze from
 *     the caption plus every slide image instead (sampled down like video
 *     frames if there are more than MAX_FRAMES_VISION of them).
 * Callers (src/index.ts, src/queue/processJob.ts) don't need to know frame
 * sampling / image fetching happens underneath either path.
 */
import { readFile } from "node:fs/promises";
import { sampleFrames } from "../video/sampleFrames.js";
import { cleanupFrames } from "../video/cleanupFrames.js";
import { analyzeVideo } from "./analyzeVideo.js";
import { uploadThumbnail } from "./uploadThumbnail.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { VideoAnalysis } from "../types.js";

/**
 * `runId` just needs to be unique enough to give this job's sampled frames
 * their own temp subdirectory (and, for the thumbnail, its own storage
 * path) -- callers pass the clip's own id (processJob) or a generated one
 * (the CLI, which has no job id).
 */
export async function analyzeSocialVideo(
  videoFilePath: string,
  caption: string | undefined,
  runId: string,
): Promise<VideoAnalysis> {
  logger.info("Sampling video frames...");
  const { frameDir, framePaths } = await sampleFrames(videoFilePath, runId);
  logger.success(`Sampled ${framePaths.length} frame(s).`);

  try {
    const images = await Promise.all(framePaths.map((path) => readFile(path)));
    logger.info("Analyzing with Claude...");
    const analysis = await analyzeVideo(images, caption);
    const middleFrame = images[Math.floor(images.length / 2)] ?? null;
    const thumbnailUrl = await uploadThumbnail(middleFrame, runId);
    return { ...analysis, thumbnailUrl };
  } finally {
    await cleanupFrames(frameDir);
  }
}

/** Best-effort fetch of one remote image -- null (not thrown) on any single failure, since the rest can still be analyzed. */
async function fetchImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Evenly picks up to `max` items across the array (same idea as sampleFrames.ts's evenly-spaced timestamps, just over a list instead of a duration). */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    const item = items[Math.floor((items.length * (i + 0.5)) / max)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/**
 * For photo/slideshow posts (no video track at all -- a TikTok photo post
 * or an Instagram carousel). `imageUrls` is every slide TikTok's page gave
 * us (see apify/tiktok.ts), or just the one cover image Instagram's Apify
 * actor provides for a carousel -- either way, sampled down to
 * MAX_FRAMES_VISION the same way video frames are, so a 16-photo "everything
 * I ate in NYC" slideshow doesn't balloon the Claude request.
 */
export async function analyzeSocialPhotoPost(
  imageUrls: string[],
  caption: string | undefined,
  runId: string,
): Promise<VideoAnalysis> {
  const sampledUrls = sampleEvenly(imageUrls, config.MAX_FRAMES_VISION);
  if (sampledUrls.length < imageUrls.length) {
    logger.info(`Slideshow has ${imageUrls.length} image(s); sampling ${sampledUrls.length} evenly.`);
  }

  const fetched = await Promise.all(sampledUrls.map(fetchImage));
  const images = fetched.filter((img): img is Buffer => img !== null);
  if (images.length < sampledUrls.length) {
    logger.warn(`Only ${images.length}/${sampledUrls.length} slide image(s) could be fetched.`);
  }

  logger.info(`Analyzing ${images.length} image(s) with Claude...`);
  const analysis = await analyzeVideo(images, caption);
  const middleImage = images[Math.floor(images.length / 2)] ?? null;
  const thumbnailUrl = await uploadThumbnail(middleImage, runId);
  return { ...analysis, thumbnailUrl };
}
