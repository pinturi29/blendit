/**
 * Turns a raw command-line string into a validated URL plus a
 * SupportedPlatform. This is the security-sensitive part of the program:
 * a naive check like `url.includes("instagram.com")` would let a malicious
 * domain such as "https://instagram.com.example.com/reel/x" through, because
 * that string *contains* "instagram.com" while actually belonging to
 * "example.com". Instead we parse the URL properly and compare the exact
 * hostname against an allow-list.
 */
import type { SupportedPlatform } from "./types.js";
import { InvalidUrlError, UnsupportedPlatformError } from "./utils/errors.js";

const INSTAGRAM_HOSTNAMES = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

const TIKTOK_HOSTNAMES = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

/** Instagram Reel/video/post paths. Anything else (profiles, stories, etc.) is rejected. */
const INSTAGRAM_VIDEO_PATH_PATTERN = /^\/(reel|reels|p|tv)\//i;

export interface DetectedPlatform {
  platform: SupportedPlatform;
  url: URL;
}

/**
 * Validates a raw URL string and identifies which platform it belongs to.
 * Throws InvalidUrlError for malformed/unsafe URLs and
 * UnsupportedPlatformError for URLs that parse fine but aren't a
 * recognized Instagram or TikTok video link.
 */
export function detectPlatform(rawUrl: string): DetectedPlatform {
  if (!rawUrl || rawUrl.trim().length === 0) {
    throw new InvalidUrlError("No URL was provided.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new InvalidUrlError(`"${rawUrl}" is not a valid URL.`);
  }

  // Only HTTPS is accepted -- rules out "http://", "ftp://", "javascript:", etc.
  if (url.protocol !== "https:") {
    throw new InvalidUrlError("Only https:// URLs are supported.");
  }

  // A URL like "https://user:pass@instagram.com/..." embeds credentials in
  // the authority section. There's no legitimate reason a public Reel/video
  // link would need these, so treat their presence as suspicious and reject.
  if (url.username || url.password) {
    throw new InvalidUrlError("URLs containing embedded credentials are not allowed.");
  }

  // Hostnames are case-insensitive; normalize before comparing against the
  // allow-lists so "Instagram.com" and "instagram.com" behave identically.
  const hostname = url.hostname.toLowerCase();

  if (INSTAGRAM_HOSTNAMES.has(hostname)) {
    if (!INSTAGRAM_VIDEO_PATH_PATTERN.test(url.pathname)) {
      throw new UnsupportedPlatformError(
        "This Instagram URL doesn't look like a Reel or video/post link " +
          '(expected a path starting with "/reel/", "/reels/", "/p/", or "/tv/").',
      );
    }
    return { platform: "instagram", url };
  }

  if (TIKTOK_HOSTNAMES.has(hostname)) {
    // TikTok short links (vm./vt.tiktok.com, tiktok.com/t/SLUG) carry no
    // predictable path shape, so we don't pattern-match the path here.
    // retrieveTikTokVideo() expands the redirect to the canonical
    // /@user/video/ID form (the Actor requires it) before downloading.
    return { platform: "tiktok", url };
  }

  throw new UnsupportedPlatformError(
    `"${hostname}" is not a supported domain. Only Instagram and TikTok URLs are accepted.`,
  );
}
