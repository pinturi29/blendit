/**
 * Instagram adapter, built against the *current* documented input/output
 * schema of the "seemuapps/instagram-video-downloader" Apify Actor
 * (verified against the Actor's published input schema and API example
 * before writing this file):
 *
 *   Input:  { postUrls: string[], saveFiles?: boolean }
 *   Output (one dataset item per URL): {
 *     postUrl, mediaType, caption, authorUsername, thumbnailUrl,
 *     videoUrl, downloads: [{ type, videoUrl, downloadUrl, ... }], ...
 *   }
 *
 * Note this Actor's real input field is `postUrls`, not a generic `urls`
 * key -- we use the exact field name the Actor documents.
 */
import { z } from "zod";
import { apifyClient } from "./client.js";
import { extractVideoUrl } from "./extractVideoUrl.js";
import { config } from "../config.js";
import type { RetrievedVideo } from "../types.js";
import { ApifyActorFailureError, EmptyApifyOutputError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Loose, "passthrough" validation of the fields we actually depend on.
 * Everything is optional because community Actor output can drift --
 * we only need to be sure that *if* a field is present, it's the type we
 * expect, before we trust it. Unknown extra fields are preserved by
 * `.passthrough()` so extractVideoUrl() can still search them.
 */
const InstagramDownloadItemSchema = z
  .object({
    type: z.string().optional(),
    videoUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
    savedUrl: z.string().nullable().optional(),
  })
  .passthrough();

const InstagramDatasetItemSchema = z
  .object({
    postUrl: z.string().optional(),
    mediaType: z.string().optional(),
    caption: z.string().optional(),
    authorUsername: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    downloads: z.array(InstagramDownloadItemSchema).optional(),
  })
  .passthrough();

export async function retrieveInstagramVideo(instagramUrl: string): Promise<RetrievedVideo> {
  const actorId = config.APIFY_INSTAGRAM_ACTOR_ID;

  logger.info(`Calling Apify Actor "${actorId}" for Instagram...`);

  const run = await apifyClient.actor(actorId).call({
    postUrls: [instagramUrl],
  });

  if (run.status !== "SUCCEEDED") {
    throw new ApifyActorFailureError(
      `The Instagram Apify Actor run did not succeed (status: ${run.status}).`,
    );
  }

  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

  if (items.length === 0) {
    throw new EmptyApifyOutputError("The Instagram Apify Actor returned no results for this URL.");
  }

  const rawItem = items[0];
  const parsed = InstagramDatasetItemSchema.safeParse(rawItem);
  const item = parsed.success ? parsed.data : (rawItem as Record<string, unknown>);

  // Instagram posts can be photos/carousels rather than videos. Unlike
  // TikTok's downloader Actor, this one still returns caption/author/
  // thumbnail for non-video posts -- it's the same call, just with no
  // videoUrl/downloads to pull from -- so a photo post degrades to
  // caption + cover-photo analysis instead of failing outright. That cover
  // image matters most for carousels/slideshows, where the caption is
  // often the entire point (e.g. a numbered list of spots).
  const mediaType = typeof item === "object" && item !== null ? (item as { mediaType?: string }).mediaType : undefined;
  const isPhotoPost = mediaType != null && mediaType.toLowerCase() !== "video" && !("videoUrl" in (item as object));
  if (isPhotoPost) {
    logger.info(`Instagram photo/carousel post detected (mediaType: "${mediaType}") -- analyzing from caption + cover photo only.`);
  }

  // Prefer the well-documented direct field, then the first video-typed
  // download entry, and only fall back to the generic heuristic search if
  // the Actor's output has drifted from its documented shape.
  const directField = (item as { videoUrl?: string }).videoUrl;
  const downloads = (item as { downloads?: Array<{ type?: string; videoUrl?: string; downloadUrl?: string }> })
    .downloads;
  const videoDownload = downloads?.find((d) => d.type === "video");

  const videoUrl = isPhotoPost
    ? undefined
    : directField || videoDownload?.videoUrl || videoDownload?.downloadUrl || extractVideoUrl(item, "Instagram dataset item");

  return {
    platform: "instagram",
    originalUrl: instagramUrl,
    videoUrl,
    caption: (item as { caption?: string }).caption,
    author: (item as { authorUsername?: string }).authorUsername,
    thumbnailUrl: (item as { thumbnailUrl?: string }).thumbnailUrl,
    apifyRunId: run.id,
  };
}
