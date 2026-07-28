/**
 * Defensive, best-effort search for a "direct video URL" inside an
 * arbitrary object returned by a third-party Apify Actor.
 *
 * Why this exists: community Actors are free to name their output fields
 * however they like, and can change those names at any time. Rather than
 * hard-coding a single field path (which breaks the moment an Actor
 * maintainer renames something), we walk the object looking for anything
 * that *looks* like a playable video URL, score every candidate, and pick
 * the best one. This is intentionally isolated in its own file so it can
 * be tuned independently of the Instagram/TikTok adapter logic.
 */
import { VideoUrlNotFoundError } from "../utils/errors.js";

/** Top-level field names that commonly hold a direct video URL. */
const DIRECT_VIDEO_FIELDS = [
  "videoUrl",
  "video_url",
  "downloadUrl",
  "download_url",
  "mp4Url",
  "mp4_url",
  "mediaUrl",
  "media_url",
  "url",
  "video",
  "play",
  "playAddr",
  "downloadAddr",
  "noWatermark",
  "videoDownloadUrl",
];

/** Container field names likely to hold nested video info (objects or arrays). */
const NESTED_CONTAINER_FIELDS = [
  "media",
  "videos",
  "video",
  "downloads",
  "result",
  "data",
  "items",
  "resources",
  "files",
];

/** Key-name fragments that suggest "this is a video", boosting a candidate's score. */
const VIDEO_HINT_FRAGMENTS = ["video", "mp4", "download", "play", "nowatermark", "media", "mp4url"];

/** Key-name fragments that suggest "this is an image/thumbnail", penalizing a candidate. */
const IMAGE_HINT_FRAGMENTS = ["thumbnail", "thumb", "cover", "poster", "avatar", "image", "picture"];

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

interface Candidate {
  keyPath: string;
  url: string;
  score: number;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function pathWithoutQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function scoreCandidate(keyPath: string, url: string): number {
  const lowerKey = keyPath.toLowerCase();
  const lowerPath = pathWithoutQuery(url).toLowerCase();

  let score = 0;

  if (VIDEO_HINT_FRAGMENTS.some((hint) => lowerKey.includes(hint))) {
    score += 10;
  }
  if (IMAGE_HINT_FRAGMENTS.some((hint) => lowerKey.includes(hint))) {
    score -= 25;
  }
  if (lowerPath.endsWith(".mp4")) {
    score += 15;
  }
  if (lowerPath.endsWith(".m3u8")) {
    // A streaming playlist, not a single file downloadVideo.ts can stream directly.
    score -= 50;
  }
  if (IMAGE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    score -= 40;
  }

  return score;
}

/** Recursively walks an unknown value, collecting every http(s) string found. */
function collectCandidates(value: unknown, keyPath: string, candidates: Candidate[], depth: number): void {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }

  if (isHttpUrl(value)) {
    candidates.push({ keyPath, url: value, score: scoreCandidate(keyPath, value) });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCandidates(item, `${keyPath}[${index}]`, candidates, depth + 1));
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const isDirectField = DIRECT_VIDEO_FIELDS.includes(key);
      const isContainerField = NESTED_CONTAINER_FIELDS.includes(key);

      // We still walk everything (some Actors nest video fields under
      // unexpected keys), but direct/container fields are exactly what we
      // expect to matter, so no special-casing is needed beyond recursing.
      if (isDirectField || isContainerField || depth < 5) {
        collectCandidates(nested, keyPath ? `${keyPath}.${key}` : key, candidates, depth + 1);
      }
    }
  }
}

/**
 * Searches `source` for the most likely direct video URL.
 *
 * @param source The raw object returned by an Apify dataset item (or similar).
 * @param context A short label (e.g. "Instagram dataset item") used only to
 *   make the thrown error readable -- never includes any field values.
 */
export function extractVideoUrl(source: unknown, context: string): string {
  const candidates: Candidate[] = [];
  collectCandidates(source, "", candidates, 0);

  // Never blindly take the first URL found -- sort by score (highest first)
  // and break ties by preferring an explicit ".mp4" extension.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aIsMp4 = pathWithoutQuery(a.url).toLowerCase().endsWith(".mp4");
    const bIsMp4 = pathWithoutQuery(b.url).toLowerCase().endsWith(".mp4");
    return Number(bIsMp4) - Number(aIsMp4);
  });

  const best = candidates[0];

  // A negative score means every candidate we found looked like an image,
  // thumbnail, or streaming manifest rather than a real video -- treat that
  // the same as "nothing found" rather than downloading a thumbnail.
  if (!best || best.score < 0) {
    const safeTopLevelKeys =
      source !== null && typeof source === "object" ? Object.keys(source as Record<string, unknown>) : [];

    throw new VideoUrlNotFoundError(
      `Could not find a direct video URL in the ${context}. ` +
        `Top-level fields present: [${safeTopLevelKeys.join(", ")}]. ` +
        "The Apify Actor's output format may have changed.",
    );
  }

  return best.url;
}
