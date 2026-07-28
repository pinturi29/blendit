/**
 * Samples video frames evenly across the whole clip's duration (not just
 * the start) and saves them as JPEGs -- mirrors
 * blendit-python/extraction/extract/vision.py's `_video_duration` /
 * `_sample_frames`, ported from Python's `subprocess` to Node's
 * `child_process`. A "top 15 spots" reel puts a different place on screen
 * every few seconds, so sampling only the first few seconds would miss
 * almost everything.
 *
 * Requires the `ffmpeg`/`ffprobe` binaries to be installed and on PATH --
 * this is a required step for every job (not gated behind a confidence
 * check the way blendit-python's vision pass is), so a missing binary fails
 * loudly with an actionable message on the very first job, rather than as a
 * cryptic ENOENT deep in a subprocess call.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { FrameExtractionError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

function isMissingBinaryError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}

function wrapMissingBinary(err: unknown, binary: string): never {
  if (isMissingBinaryError(err)) {
    throw new FrameExtractionError(
      `"${binary}" was not found on PATH. Install it (e.g. \`brew install ffmpeg\` on macOS) ` +
        "and restart the worker -- frame sampling for video analysis requires it.",
    );
  }
  throw err;
}

async function videoDurationSeconds(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      { timeout: config.FFMPEG_TIMEOUT_MS },
    );
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch (err) {
    if (isMissingBinaryError(err)) wrapMissingBinary(err, "ffprobe");
    return 0; // duration probing failing isn't fatal -- fall back to first-N-seconds sampling
  }
}

async function extractFrameAt(videoPath: string, timestampSeconds: number, outPath: string): Promise<boolean> {
  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-ss", timestampSeconds.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "3", outPath],
      { timeout: config.FFMPEG_TIMEOUT_MS },
    );
    return true;
  } catch (err) {
    wrapMissingBinary(err, "ffmpeg");
    return false;
  }
}

/** Fallback when duration is unknown: grab the first `count` one-per-second frames. */
async function extractFirstSecondsFallback(videoPath: string, count: number, outDir: string): Promise<string[]> {
  const pattern = path.join(outDir, "frame_%03d.jpg");
  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", videoPath, "-vf", "fps=1", "-frames:v", String(count), pattern],
      { timeout: config.FFMPEG_TIMEOUT_MS },
    );
  } catch (err) {
    wrapMissingBinary(err, "ffmpeg");
  }
  const files = await readdir(outDir);
  return files
    .filter((f) => f.startsWith("frame_"))
    .sort()
    .slice(0, count)
    .map((f) => path.join(outDir, f));
}

export interface SampledFrames {
  frameDir: string;
  framePaths: string[];
}

export async function sampleFrames(videoPath: string, jobId: string): Promise<SampledFrames> {
  const frameDir = path.join(config.DOWNLOAD_DIRECTORY, "frames", jobId);
  await mkdir(frameDir, { recursive: true });

  const count = config.MAX_FRAMES_VISION;
  const duration = await videoDurationSeconds(videoPath);

  if (duration <= 0) {
    logger.warn("Could not determine video duration; sampling the first few seconds instead.");
    const framePaths = await extractFirstSecondsFallback(videoPath, count, frameDir);
    return { frameDir, framePaths };
  }

  const framePaths: string[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = (duration * (i + 0.5)) / count; // midpoint of segment i
    const outPath = path.join(frameDir, `frame_${String(i).padStart(3, "0")}.jpg`);
    const ok = await extractFrameAt(videoPath, timestamp, outPath);
    if (ok) framePaths.push(outPath);
  }

  return { frameDir, framePaths };
}
