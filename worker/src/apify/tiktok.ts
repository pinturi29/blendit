/**
 * TikTok adapter, built against the *current* documented input/output
 * schema of the "crawlerbros/tiktok-downloader-api" Apify Actor (verified
 * against the Actor's published input schema and README before writing
 * this file). Unlike the Instagram Actor, this one does NOT return a
 * normal external CDN link in its dataset -- it downloads each requested
 * asset (video / cover / audio / image) into Apify's Key-Value Store and
 * emits one dataset row per asset:
 *
 *   Input:  {
 *     postUrls: string[],
 *     assetTypes?: ("video"|"images"|"audio"|"cover")[],
 *     preferredQuality?: "best"|"720p"|"540p"|"360p"|"smallest",
 *   }
 *   Output (one dataset row per asset): {
 *     postId, postUrl, assetType, ordinal, kvsKey, kvsUrl, mimeType,
 *     byteSize, width, height, duration, error?, ...
 *   }
 *
 * MIGRATION FIX (2026-07): the Actor's own docs describe `kvsUrl` as
 * publicly fetchable with no token required, but that's not what was
 * observed in practice -- fetching it directly 403s, and fetching the same
 * URL with `?token=<APIFY_API_TOKEN>` appended returns 200. (Confirmed by
 * fetching both ways against a real run's kvsUrl.) So every Apify KVS URL
 * this file hands to the generic downloader in video/downloadVideo.ts now
 * carries the token as a query param -- see withApifyToken() below.
 */
import { z } from "zod";
import { apifyClient } from "./client.js";
import { extractVideoUrl } from "./extractVideoUrl.js";
import { config } from "../config.js";
import type { RetrievedVideo } from "../types.js";
import { ApifyActorFailureError, EmptyApifyOutputError, VideoUrlNotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const TikTokDatasetItemSchema = z
  .object({
    postId: z.string().optional(),
    postUrl: z.string().optional(),
    assetType: z.string().optional(),
    kvsKey: z.string().optional(),
    kvsUrl: z.string().optional(),
    mimeType: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

type TikTokDatasetItem = z.infer<typeof TikTokDatasetItemSchema>;

function buildKvsRecordUrl(storeId: string, key: string): string {
  // Apify's REST endpoint for reading a single Key-Value Store record by
  // key -- requires an API token to actually fetch (see the file header).
  return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`;
}

/** Appends the Apify API token as a query param, but only to api.apify.com URLs -- a no-op for anything else (e.g. extractVideoUrl()'s fallback finding a non-Apify URL). */
function withApifyToken(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "api.apify.com") {
      parsed.searchParams.set("token", config.APIFY_API_TOKEN);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * The downloader Actor's dataset rows only describe the downloaded asset
 * (postId, kvsUrl, mimeType, ...) -- it has no caption/hashtag/author field
 * at all, unlike the Instagram Actor. Without a caption, Claude has to guess
 * a clip's location purely from 8 video frames, which is exactly how a
 * generic "street food" clip once got geocoded to a same-named business in
 * the wrong city entirely. TikTok's public oEmbed endpoint fills that gap:
 * no auth needed, and its `title` field is the post's actual caption
 * (hashtags included). Best-effort -- a failure here shouldn't fail the
 * whole clip, it just means Claude is back to frames-only like before.
 *
 * Video posts only -- confirmed (a real request against a real /photo/ URL)
 * that oEmbed returns a 400 for photo/slideshow posts even though the exact
 * same request shape works fine for a /video/ URL. See
 * fetchSlideshowData() below for how photo posts are handled instead.
 */
async function fetchOEmbedMetadata(url: string): Promise<{ caption?: string; author?: string; thumbnailUrl?: string }> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { caption: data.title, author: data.author_name, thumbnailUrl: data.thumbnail_url };
  } catch {
    return {};
  }
}

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

interface SlideshowData {
  images: string[];
  caption?: string;
  author?: string;
}

/**
 * Photo/slideshow posts have no video track at all -- neither the
 * downloader Actor (rejects /photo/ postUrls outright) nor oEmbed (see
 * above) exposes them. The post's own page HTML embeds a
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON blob with the full item data,
 * including every slide's image URL and the real caption -- undocumented
 * and could break if TikTok changes their page's internal data shape, but
 * confirmed working against a real slideshow post (16 images, all directly
 * fetchable with no extra auth). This is really the same category of
 * approach the downloader Actor itself uses under the hood (its own logs
 * show it browser-automating these same pages) -- just done directly,
 * without spending Apify credits or hitting Apify's own usage limits.
 */
async function fetchSlideshowData(url: string): Promise<SlideshowData | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": MOBILE_USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
    if (!match?.[1]) return null;

    const data = JSON.parse(match[1]) as {
      __DEFAULT_SCOPE__?: {
        "webapp.reflow.video.detail"?: {
          itemInfo?: {
            itemStruct?: {
              desc?: string;
              author?: { uniqueId?: string };
              imagePost?: { images?: Array<{ imageURL?: { urlList?: string[] } }> };
            };
          };
        };
      };
    };
    const item = data.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct;
    const images = (item?.imagePost?.images ?? [])
      .map((img) => img.imageURL?.urlList?.[0])
      .filter((u): u is string => !!u);

    if (images.length === 0) return null;
    return { images, caption: item?.desc, author: item?.author?.uniqueId };
  } catch (err) {
    logger.warn(`Could not read TikTok slideshow data (${(err as Error).message}).`);
    return null;
  }
}

/**
 * TikTok short links (vm./vt.tiktok.com and tiktok.com/t/SLUG) redirect to a
 * canonical `/@user/video/ID` (or `/@user/photo/ID`) URL. The downloader Actor
 * REQUIRES that canonical form — it rejects raw short links with "No valid
 * TikTok post URLs or IDs found" — so we must expand the redirect ourselves
 * first (the earlier assumption that the Actor resolves it was wrong).
 */
async function resolveTikTokUrl(rawUrl: string): Promise<string> {
  const isShortlink = /\/t\//.test(rawUrl) || /^https:\/\/(vm|vt)\.tiktok\.com/i.test(rawUrl);
  if (!isShortlink) return rawUrl;
  try {
    const resp = await fetch(rawUrl, { method: "GET", redirect: "follow" });
    const finalUrl = resp.url || rawUrl;
    if (finalUrl !== rawUrl) {
      logger.info(`Resolved TikTok short link -> ${finalUrl.split("?")[0]}`);
    }
    return finalUrl;
  } catch {
    return rawUrl; // best effort — let the Actor try the original and error clearly
  }
}

export async function retrieveTikTokVideo(tiktokUrl: string): Promise<RetrievedVideo> {
  const actorId = config.APIFY_TIKTOK_ACTOR_ID;

  const resolvedUrl = await resolveTikTokUrl(tiktokUrl);

  // Photo/slideshow posts have no video track -- the downloader Actor
  // rejects them outright ("No valid TikTok post URLs or IDs found") and
  // oEmbed 400s on them too, so neither is usable. Read every slide image
  // plus the caption directly from the post's own page instead.
  if (/\/photo\//.test(resolvedUrl)) {
    logger.info("TikTok photo/slideshow post detected -- reading slide images directly from the post page.");
    const slideshow = await fetchSlideshowData(resolvedUrl);
    if (!slideshow) {
      throw new VideoUrlNotFoundError(
        "Couldn't read this TikTok slideshow post -- it may be private, deleted, or TikTok's page format changed.",
      );
    }
    logger.success(`Found ${slideshow.images.length} slide image(s).`);
    return {
      platform: "tiktok",
      originalUrl: tiktokUrl,
      videoUrl: undefined,
      author: slideshow.author,
      caption: slideshow.caption,
      thumbnailUrl: slideshow.images[0],
      slideImageUrls: slideshow.images,
    };
  }

  logger.info(`Calling Apify Actor "${actorId}" for TikTok...`);

  const [run, metadata] = await Promise.all([
    apifyClient.actor(actorId).call({
      postUrls: [resolvedUrl],
      assetTypes: ["video", "cover"],
      preferredQuality: "best",
    }),
    fetchOEmbedMetadata(resolvedUrl),
  ]);

  if (run.status !== "SUCCEEDED") {
    throw new ApifyActorFailureError(`The TikTok Apify Actor run did not succeed (status: ${run.status}).`);
  }

  const { items: rawItems } = await apifyClient.dataset(run.defaultDatasetId).listItems();

  if (rawItems.length === 0) {
    throw new EmptyApifyOutputError("The TikTok Apify Actor returned no results for this URL.");
  }

  const items: TikTokDatasetItem[] = rawItems.map((raw) => {
    const parsed = TikTokDatasetItemSchema.safeParse(raw);
    return parsed.success ? parsed.data : (raw as TikTokDatasetItem);
  });

  const failedItem = items.find((item) => item.error);
  const videoItem = items.find((item) => item.assetType?.toLowerCase() === "video" && !item.error);

  if (!videoItem) {
    if (failedItem?.error) {
      throw new ApifyActorFailureError(`The TikTok Actor failed to fetch this video: ${failedItem.error}`);
    }
    throw new VideoUrlNotFoundError(
      "The TikTok Actor did not return a video asset for this URL (only non-video assets were found).",
    );
  }

  const storeId = run.defaultKeyValueStoreId;
  const videoUrl = withApifyToken(
    videoItem.kvsUrl ||
      (videoItem.kvsKey && storeId ? buildKvsRecordUrl(storeId, videoItem.kvsKey) : undefined) ||
      extractVideoUrl(videoItem, "TikTok dataset item"),
  );

  // Thumbnail is best-effort only -- never let a missing/odd cover asset
  // fail the whole run.
  let thumbnailUrl: string | undefined;
  const coverItem = items.find((item) => item.assetType?.toLowerCase() === "cover" && !item.error);
  if (coverItem) {
    const rawThumbnailUrl =
      coverItem.kvsUrl || (coverItem.kvsKey && storeId ? buildKvsRecordUrl(storeId, coverItem.kvsKey) : undefined);
    thumbnailUrl = rawThumbnailUrl ? withApifyToken(rawThumbnailUrl) : undefined;
  }

  return {
    platform: "tiktok",
    originalUrl: tiktokUrl,
    videoUrl,
    author: metadata.author,
    caption: metadata.caption,
    thumbnailUrl,
    apifyRunId: run.id,
  };
}
