/**
 * One shared Supabase client, authenticated with the SERVICE ROLE key --
 * mirrors gemini/client.ts's "one shared client" pattern. The service role
 * bypasses row-level security entirely, which is what lets this worker
 * claim jobs and write results for clips it doesn't own; it must never be
 * used anywhere but this trusted backend process.
 *
 * Only src/worker.ts needs this (not the single-URL CLI in src/index.ts),
 * so the required-ness check happens here rather than in config.ts's
 * schema -- importing this module is what "opts in" to needing these vars.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { SupabaseConfigError } from "../utils/errors.js";

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
  throw new SupabaseConfigError(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to run the queue worker. " +
      "Copy .env.example to .env and fill in both (Project Settings -> API in your Supabase " +
      "dashboard -- SUPABASE_SERVICE_ROLE_KEY is the service_role secret, not the anon key).",
  );
}

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
