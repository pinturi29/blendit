/**
 * One shared Anthropic client, authenticated with ANTHROPIC_API_KEY. Reused
 * by the analysis step -- mirrors the old gemini/client.ts's "one shared
 * client" pattern.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});
