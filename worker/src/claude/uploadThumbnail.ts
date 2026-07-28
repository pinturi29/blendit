/**
 * Uploads a single already-in-memory image (one of the frames sampled for
 * Claude, or a photo post's cover image) as a clip's representative
 * thumbnail, instead of discarding it after analysis. Which image to pass
 * is the caller's call -- for sampled video frames that's the middle one
 * (an early frame is often a transition/blank moment, the middle is
 * usually the most representative of what the clip actually shows); for a
 * photo post there's only ever the one cover image anyway.
 *
 * Supabase is imported dynamically and every failure is swallowed (logged,
 * not thrown): this must never fail the whole job over a nice-to-have, and
 * the CLI (src/index.ts) calls the same analysis path without Supabase
 * configured at all -- a static top-level import of supabase/client.js
 * would break CLI usage outright, since that module validates its config
 * the moment it's loaded.
 */
import { logger } from "../utils/logger.js";

export async function uploadThumbnail(image: Buffer | null, jobId: string): Promise<string | null> {
  if (!image) return null;

  try {
    const { supabase } = await import("../supabase/client.js");

    const path = `${jobId}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("clip-thumbnails")
      .upload(path, image, { contentType: "image/jpeg", upsert: true });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from("clip-thumbnails").getPublicUrl(path);
    return `${publicUrl}?t=${Date.now()}`;
  } catch (err) {
    logger.warn(`Could not upload a clip thumbnail (${(err as Error).message}) -- continuing without one.`);
    return null;
  }
}
