/**
 * Streams a remote video URL to a local temporary .mp4 file using Node's
 * built-in fetch + streams -- no third-party HTTP client needed.
 *
 * Design notes:
 * - We stream straight to disk (fetch -> Transform byte-counter -> file)
 *   instead of buffering the whole video in memory, since videos can be
 *   large and this is meant to run on a modest machine.
 * - We enforce MAX_VIDEO_SIZE_MB twice: once cheaply via the
 *   "Content-Length" response header (if the server sends one, we can
 *   reject before downloading a single byte), and again while streaming
 *   (in case Content-Length is missing or lies), so a misbehaving or
 *   malicious server can't force us to fill the disk.
 */
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { DownloadError, FileTooLargeError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { DownloadedVideo } from "../types.js";

/** Generous but bounded -- large enough for most short-form videos, short enough to fail fast on a dead/slow host. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** A normal browser UA avoids some CDNs' bot-blocking heuristics for plain server-to-server requests. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const ACCEPTED_CONTENT_TYPE_PREFIXES = ["video/mp4", "video/quicktime", "application/octet-stream"];
const REJECTED_CONTENT_TYPE_FRAGMENTS = ["text/html", "application/json", "text/json"];

export interface DownloadVideoOptions {
  videoUrl: string;
  downloadDirectory: string;
  maxSizeMb: number;
}

export async function downloadVideo(options: DownloadVideoOptions): Promise<DownloadedVideo> {
  const { videoUrl, downloadDirectory, maxSizeMb } = options;
  const maxBytes = maxSizeMb * 1024 * 1024;

  await mkdir(downloadDirectory, { recursive: true });

  const absoluteDownloadDir = path.resolve(downloadDirectory);
  // crypto.randomUUID() guarantees a collision-free, unpredictable filename
  // so concurrent runs (or repeated runs) never clash or overwrite files.
  const filePath = path.join(absoluteDownloadDir, `${randomUUID()}.mp4`);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(videoUrl, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new DownloadError(`Timed out connecting to the video host after ${DOWNLOAD_TIMEOUT_MS / 1000}s.`);
      }
      throw new DownloadError(`Network error while downloading the video: ${(err as Error).message}`);
    }

    if (!response.ok) {
      throw new DownloadError(`The video host responded with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (REJECTED_CONTENT_TYPE_FRAGMENTS.some((fragment) => contentType.includes(fragment))) {
      throw new DownloadError(
        `Expected a video file but received a "${contentType}" response (likely an error page, not a video).`,
      );
    }
    if (contentType && !ACCEPTED_CONTENT_TYPE_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
      logger.warn(`Unexpected content-type "${contentType}" for the video download -- proceeding cautiously.`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        throw new FileTooLargeError(
          `The video is ${(declaredBytes / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${maxSizeMb} MB limit.`,
        );
      }
    }

    if (!response.body) {
      throw new DownloadError("The video response did not include any content.");
    }

    let downloadedBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(new FileTooLargeError(`The video exceeded the ${maxSizeMb} MB limit while downloading.`));
          return;
        }
        callback(null, chunk);
      },
    });

    const nodeReadable = Readable.fromWeb(response.body as NodeWebReadableStream<Uint8Array>);

    try {
      await pipeline(nodeReadable, sizeGuard, createWriteStream(filePath));
    } catch (err) {
      await unlink(filePath).catch(() => undefined);
      if (err instanceof FileTooLargeError) throw err;
      if (controller.signal.aborted) {
        throw new DownloadError(`Timed out downloading the video after ${DOWNLOAD_TIMEOUT_MS / 1000}s.`);
      }
      throw new DownloadError(`Failed while saving the video to disk: ${(err as Error).message}`);
    }

    const fileStat = await stat(filePath);
    return { filePath, sizeBytes: fileStat.size };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
