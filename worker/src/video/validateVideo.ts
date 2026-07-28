/**
 * Post-download sanity checks. downloadVideo() already enforces the size
 * limit while streaming, but we re-check here so this file remains a
 * single, obvious place that answers "is this really a usable video file?"
 * -- useful both right after downloading and if this function is ever
 * reused elsewhere.
 */
import { open, stat } from "node:fs/promises";
import { DownloadError, FileTooLargeError } from "../utils/errors.js";

/** Enough bytes to recognize an HTML or JSON error page without reading the whole file. */
const SNIFF_BYTE_COUNT = 64;

export async function validateVideo(filePath: string, maxSizeMb: number): Promise<void> {
  const maxBytes = maxSizeMb * 1024 * 1024;

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new DownloadError("The downloaded video file could not be found on disk.");
  }

  if (fileStat.size === 0) {
    throw new DownloadError("The downloaded video file is empty.");
  }

  if (fileStat.size > maxBytes) {
    throw new FileTooLargeError(
      `The downloaded video is ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB, ` +
        `exceeding the ${maxSizeMb} MB limit.`,
    );
  }

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTE_COUNT);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTE_COUNT, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8").trim().toLowerCase();

    const looksLikeHtml = sample.startsWith("<") || sample.includes("<html") || sample.includes("<!doctype");
    const looksLikeJson = sample.startsWith("{") || sample.startsWith("[");

    if (looksLikeHtml || looksLikeJson) {
      throw new DownloadError(
        "The downloaded file looks like an HTML or JSON error page, not a video -- " +
          "the source video URL may have expired or the Apify Actor's response format changed.",
      );
    }
  } finally {
    await handle.close();
  }
}
