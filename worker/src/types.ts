/**
 * Shared types used across module boundaries (Apify -> download -> Claude).
 * Keeping them in one file avoids circular imports between the feature
 * folders and gives a single place to see the "shape" of the pipeline.
 */

/** The two social platforms this prototype understands. */
export type SupportedPlatform = "instagram" | "tiktok";

/**
 * The common shape both Apify adapters (Instagram and TikTok) must return,
 * regardless of how different the underlying Actors' raw output looks.
 * Everything downstream of Apify (downloading, Claude) only ever depends
 * on this normalized type.
 *
 * videoUrl is absent for photo/slideshow posts (carousels, TikTok photo
 * posts) -- there's no video track to download at all. The pipeline falls
 * back to analyzing the caption plus slideImageUrls/thumbnailUrl instead of
 * downloading + sampling frames -- see claude/index.ts's
 * analyzeSocialPhotoPost().
 */
export interface RetrievedVideo {
  platform: SupportedPlatform;
  originalUrl: string;
  videoUrl?: string;
  caption?: string;
  author?: string;
  thumbnailUrl?: string;
  /** Every slide image for a photo/slideshow post, in order -- undefined for a video post, or for a photo post where only a single cover image is available (see apify/instagram.ts). */
  slideImageUrls?: string[];
  apifyRunId?: string;
}

/** Result of streaming a remote video to a local temp file. */
export interface DownloadedVideo {
  /** Absolute path to the downloaded .mp4 file on disk. */
  filePath: string;
  sizeBytes: number;
}

/** One distinct real-world place Claude recognized -- a clip can name several (e.g. a "top 10 spots" video). */
export interface PlaceCandidate {
  name: string;
  /** Short 1-3 word category, e.g. "Bar", "Food cart" -- optional. */
  category?: string;
  /** A street address for this specific place, if the caption or on-screen text gave one -- geocodes far more reliably than the name alone. */
  address?: string;
}

/** Structured result of a Claude analysis call (see claude/analyzeVideo.ts). */
export interface VideoAnalysis {
  title: string;
  summary: string;
  /** Every distinct place recognized from the caption or frames, most confident first. */
  locations: PlaceCandidate[];
  /** One of the sampled frames, kept as a representative thumbnail; null if none could be uploaded. */
  thumbnailUrl: string | null;
}

/** A place candidate after an attempted geocode -- lat/lng/shortLocation are null if nothing matched. */
export interface GeocodedPlace {
  name: string;
  category: string | null;
  shortLocation: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * A `trip_clips` row from the blendit app's Supabase database, as claimed by
 * claim_next_clip_job() (see the 0011 migration in the blendit repo). Only
 * the columns this worker actually reads/writes are modeled here.
 */
export interface ClipJob {
  id: string;
  trip_id: string;
  source: "TikTok" | "Instagram Reels";
  url: string;
  status: "pending" | "processing" | "done" | "error";
}

/**
 * A `trip_itineraries` row, as claimed by claim_next_itinerary_job() (see
 * the 0017 migration). Only the columns this worker actually reads/writes
 * are modeled here.
 */
export interface ItineraryJob {
  id: string;
  trip_id: string;
  status: "pending" | "processing" | "done" | "error";
  wake_time: string;
  sleep_time: string;
}
