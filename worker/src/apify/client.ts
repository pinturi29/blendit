/**
 * One shared ApifyClient instance, authenticated with the single
 * APIFY_API_TOKEN from the environment. Both the Instagram and TikTok
 * adapters import this same client -- there is no reason to create a new
 * one per request, and doing so would just add overhead.
 */
import { ApifyClient } from "apify-client";
import { config } from "../config.js";

export const apifyClient = new ApifyClient({
  token: config.APIFY_API_TOKEN,
});
