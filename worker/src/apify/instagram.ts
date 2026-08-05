/**
 * Instagram adapter, built against the *current* documented input/output
 * schema of the "seemuapps/instagram-video-downloader" Apify Actor
 * (verified against the Actor's published input schema and API example
 * before writing this file):
 *
 *   Input:  { postUrls: string[], saveFiles?: boolean }
 *   Output (one dataset item per URL): {
 *     postUrl, mediaType, caption, authorUsername, thumbnailUrl,
 *     videoUrl, downloads: [{ index, type, imageUrl, videoUrl, downloadUrl,
 *     width, height, savedUrl, ... }], ...
 *   }
 *
 * Note this Actor's real input field is `postUrls`, not a generic `urls`
 * key -- we use the exact field name the Actor documents.
 *
 * Carousels: the Actor returns one `downloads` entry per slide (confirmed
 * against the Actor's published docs) -- each slide is either type "image"
 * or "video", in post order via its own `index`. This is what lets a
 * carousel/slideshow post get every slide analyzed (via slideImageUrls),
 * not just a single cover photo.
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
    index: z.number().optional(),
    type: z.string().optional(),
    imageUrl: z.string().optional(),
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

  // Prefer the well-documented direct field, then the first video-typed
  // download entry, and only fall back to the generic heuristic search if
  // the Actor's output has drifted from its documented shape.
  const directField = (item as { videoUrl?: string | null }).videoUrl;
  const downloads = (
    item as {
      downloads?: Array<{ index?: number; type?: string; imageUrl?: string; videoUrl?: string; downloadUrl?: string }>;
    }
  ).downloads;
  const videoDownload = downloads?.find((d) => d.type === "video");
  const candidateVideoUrl =
    directField || videoDownload?.videoUrl || videoDownload?.downloadUrl || extractVideoUrl(item, "Instagram dataset item");

  // Instagram posts can be photos/carousels rather than videos. Unlike
  // TikTok's downloader Actor, this one still returns caption/author/
  // downloads for non-video posts -- it's the same call, just with no
  // usable videoUrl to pull from -- so a photo post degrades to caption +
  // every slide image instead of failing outright (see slideImageUrls
  // below). That matters most for carousels/slideshows, where a numbered
  // list of spots is often spread one-per-slide rather than in the caption.
  //
  // Checking mediaType alone isn't reliable here (a carousel/photo item can
  // still have a `videoUrl` *key* present but empty/null), and checking
  // "'videoUrl' in item" isn't either -- what actually matters is whether a
  // real, non-empty URL was found above. Trusting a falsy-but-present
  // videoUrl as "this is a video" is exactly what previously sent
  // slideshow posts into downloadVideo(), which then choked on whatever
  // non-video response that bogus URL produced.
  const mediaType = typeof item === "object" && item !== null ? (item as { mediaType?: string }).mediaType : undefined;
  const isPhotoPost = !candidateVideoUrl || (mediaType != null && mediaType.toLowerCase() !== "video");
  if (isPhotoPost) {
    logger.info(`Instagram photo/carousel post detected (mediaType: "${mediaType}") -- analyzing from caption + slide image(s).`);
  }

  const videoUrl = isPhotoPost ? undefined : candidateVideoUrl;

  // Every image-typed slide, in post order -- undefined (not an empty
  // array) when there's nothing to show beyond the cover photo, so
  // processJob.ts's `slideImageUrls ?? [thumbnailUrl]` fallback still
  // applies for a plain single-image post.
  const slideImageUrls = isPhotoPost
    ? (downloads ?? [])
        .filter((d) => d.type === "image")
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((d) => d.downloadUrl || d.imageUrl)
        .filter((u): u is string => !!u)
    : undefined;
  if (isPhotoPost && slideImageUrls && slideImageUrls.length > 1) {
    logger.success(`Found ${slideImageUrls.length} carousel slide(s).`);
  }

  const thumbnailUrl = (item as { thumbnailUrl?: string }).thumbnailUrl || slideImageUrls?.[0];

  return {
    platform: "instagram",
    originalUrl: instagramUrl,
    videoUrl,
    caption: (item as { caption?: string }).caption,
    author: (item as { authorUsername?: string }).authorUsername,
    thumbnailUrl,
    slideImageUrls: slideImageUrls && slideImageUrls.length > 0 ? slideImageUrls : undefined,
    apifyRunId: run.id,
  };
}
