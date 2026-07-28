/**
 * Runs one claimed trip_clips row through the exact same pipeline as the
 * CLI (src/index.ts) -- detect platform, Apify -> direct MP4, download,
 * Claude analysis, cleanup -- then geocodes the best location match and
 * writes the result back to Supabase. Used by src/worker.ts's poll loop.
 */
import { detectPlatform } from "../platform.js";
import { retrieveVideo } from "../apify/index.js";
import { downloadVideo } from "../video/downloadVideo.js";
import { validateVideo } from "../video/validateVideo.js";
import { cleanupVideo } from "../video/cleanupVideo.js";
import { analyzeSocialPhotoPost, analyzeSocialVideo } from "../claude/index.js";
import { geocodePlaces } from "../geocode.js";
import { config } from "../config.js";
import { supabase } from "../supabase/client.js";
import { logger } from "../utils/logger.js";
import { isAppError } from "../utils/errors.js";
import type { ClipJob } from "../types.js";

async function markError(jobId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("trip_clips")
    .update({ status: "error", error_message: message })
    .eq("id", jobId);
  if (error) {
    logger.error(`Failed to mark clip ${jobId} as errored: ${error.message}`);
  }
}

export async function processJob(job: ClipJob, laneId?: number): Promise<void> {
  const prefix = laneId !== undefined ? `[lane ${laneId}] ` : "";
  logger.info(`${prefix}Processing clip ${job.id} (${job.url})`);

  let downloadedFilePath: string | null = null;
  try {
    const { platform } = detectPlatform(job.url);
    const retrieved = await retrieveVideo(job.url, platform);

    let analysis;
    if (retrieved.videoUrl) {
      const downloaded = await downloadVideo({
        videoUrl: retrieved.videoUrl,
        downloadDirectory: config.DOWNLOAD_DIRECTORY,
        maxSizeMb: config.MAX_VIDEO_SIZE_MB,
      });
      downloadedFilePath = downloaded.filePath;
      await validateVideo(downloaded.filePath, config.MAX_VIDEO_SIZE_MB);
      analysis = await analyzeSocialVideo(downloaded.filePath, retrieved.caption, job.id);
    } else {
      // Photo/slideshow post -- no video track, analyze from the caption
      // plus every slide image instead (see apify/tiktok.ts and
      // apify/instagram.ts for how each platform detects this case).
      const imageUrls = retrieved.slideImageUrls ?? (retrieved.thumbnailUrl ? [retrieved.thumbnailUrl] : []);
      analysis = await analyzeSocialPhotoPost(imageUrls, retrieved.caption, job.id);
    }
    // Bias geocoding toward the trip's own destination, so a chain like
    // "The Halal Guys" (many branches, many cities) resolves to the one
    // actually near this trip instead of Google's globally top-ranked match.
    const { data: trip } = await supabase.from("trips").select("lat, lng").eq("id", job.trip_id).maybeSingle();
    const bias = trip?.lat != null && trip?.lng != null ? { lat: trip.lat, lng: trip.lng } : undefined;
    const geocodedPlaces = await geocodePlaces(analysis.locations, bias);

    const { error } = await supabase
      .from("trip_clips")
      .update({
        status: "done",
        title: analysis.title,
        summary: analysis.summary,
        thumbnail_url: analysis.thumbnailUrl,
        author: retrieved.author ?? null,
        // Clears any stale error from an earlier failed attempt on this
        // same clip -- without this, a successful retry still shows the
        // old error text sitting alongside status: "done".
        error_message: null,
      })
      .eq("id", job.id);
    if (error) throw new Error(`Failed to save the result: ${error.message}`);

    // Replace rather than append -- a retried/requeued clip shouldn't pile
    // up duplicate place rows from its earlier attempt.
    const { error: deleteError } = await supabase.from("clip_places").delete().eq("clip_id", job.id);
    if (deleteError) throw new Error(`Failed to clear previous places: ${deleteError.message}`);

    if (geocodedPlaces.length > 0) {
      const { error: placesError } = await supabase.from("clip_places").insert(
        geocodedPlaces.map((place, rank) => ({
          clip_id: job.id,
          name: place.name,
          category: place.category,
          location_name: place.shortLocation,
          lat: place.lat,
          lng: place.lng,
          rank,
        })),
      );
      if (placesError) throw new Error(`Failed to save places: ${placesError.message}`);
    }

    logger.success(`${prefix}Clip ${job.id} done: "${analysis.title}" (${geocodedPlaces.length} place(s))`);
  } catch (err) {
    const message = isAppError(err) ? err.message : err instanceof Error ? err.message : String(err);
    logger.error(`${prefix}Clip ${job.id} failed: ${message}`);
    await markError(job.id, message);
  } finally {
    if (downloadedFilePath) {
      await cleanupVideo(downloadedFilePath, config.DOWNLOAD_DIRECTORY);
    }
  }
}
