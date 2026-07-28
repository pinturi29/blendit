/**
 * Barrel module: the rest of the program only needs to call
 * `retrieveVideo(url, platform)` and doesn't need to know that Instagram
 * and TikTok are implemented as two entirely separate adapters underneath.
 */
import type { RetrievedVideo, SupportedPlatform } from "../types.js";
import { retrieveInstagramVideo } from "./instagram.js";
import { retrieveTikTokVideo } from "./tiktok.js";

export async function retrieveVideo(url: string, platform: SupportedPlatform): Promise<RetrievedVideo> {
  switch (platform) {
    case "instagram":
      return retrieveInstagramVideo(url);
    case "tiktok":
      return retrieveTikTokVideo(url);
  }
}

export type { RetrievedVideo };
