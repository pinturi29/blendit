/**
 * Loads and validates every environment variable the program needs, in one
 * place, at startup. Using Zod here means a missing or malformed value is
 * caught immediately with a clear message, instead of causing a confusing
 * crash deep inside an Apify or Claude call later on.
 *
 * This worker lives inside the blendit app's repo (worker/) but is a
 * separate Node process with its own package.json -- it deliberately reads
 * its secrets from the repo root's .env (one level up from worker/), the
 * same file the Expo app already uses, instead of keeping a second copy.
 * Nothing under worker/ is ever imported by the app's React Native code, so
 * these values (unlike the app's own EXPO_PUBLIC_* vars) never end up in
 * the shipped app bundle.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { EnvironmentValidationError } from "./utils/errors.js";

const REPO_ROOT_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
dotenv.config({ path: REPO_ROOT_ENV_PATH });

/**
 * `z.coerce.number()` lets values like "200" (as they always arrive from
 * process.env, which is string-only) become real numbers before the rest
 * of the app uses them.
 */
const envSchema = z.object({
  APIFY_API_TOKEN: z
    .string({ required_error: "APIFY_API_TOKEN is required." })
    .min(1, "APIFY_API_TOKEN cannot be empty."),
  ANTHROPIC_API_KEY: z
    .string({ required_error: "ANTHROPIC_API_KEY is required." })
    .min(1, "ANTHROPIC_API_KEY cannot be empty."),
  GOOGLE_PLACES_API_KEY: z
    .string({ required_error: "GOOGLE_PLACES_API_KEY is required." })
    .min(1, "GOOGLE_PLACES_API_KEY cannot be empty."),

  // Optional here -- only src/worker.ts (the queue worker) needs these, not
  // the single-URL CLI (src/index.ts), and both import this same config
  // module. src/supabase/client.ts does its own required-ness check so the
  // CLI keeps working with no Supabase setup at all.
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_STALE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  // How many clips to process at once. Each one is a real, simultaneous
  // Apify actor run + Claude call -- higher means clips clear faster when
  // several land at once, but also more parallel cost and a higher chance
  // of hitting Apify/Anthropic's per-account rate limits. 3 is a
  // conservative starting point, not a measured ceiling for your account.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),

  APIFY_INSTAGRAM_ACTOR_ID: z.string().min(1).default("seemuapps/instagram-video-downloader"),
  APIFY_TIKTOK_ACTOR_ID: z.string().min(1).default("crawlerbros/tiktok-downloader-api"),

  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  MAX_FRAMES_VISION: z.coerce.number().int().positive().default(8),
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  DOWNLOAD_DIRECTORY: z.string().min(1).default("downloads"),
  MAX_VIDEO_SIZE_MB: z.coerce.number().positive().default(200),

  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parses `process.env` against the schema above.
 *
 * On failure we build a message that lists which variables are missing or
 * invalid *by name only* -- never their values -- so a validation failure
 * can never leak a partially-typed secret into the terminal or a log file.
 */
function loadConfig(): AppConfig {
  // Reuse the app's own EXPO_PUBLIC_SUPABASE_URL when a plain SUPABASE_URL
  // isn't set, so the shared .env doesn't need the same URL written twice
  // under two different names.
  const input = {
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
  };

  const result = envSchema.safeParse(input);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new EnvironmentValidationError(
      `Missing or invalid environment variables:\n${problems}\n\n` +
        "Fill in the required values in the repo root's .env file.",
    );
  }

  return result.data;
}

export const config: AppConfig = loadConfig();
