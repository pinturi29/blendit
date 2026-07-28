/**
 * Asks Claude to analyze a social video's caption plus a handful of frames
 * sampled evenly across it (see ../video/sampleFrames.ts), and returns a
 * structured { title, summary, locations } result. Claude has no way to
 * ingest a raw video file the way Gemini's Files API did, so this is the
 * substitute: caption text + representative still frames, sent as images in
 * one message.
 *
 * Uses tool use (forcing a single, specific tool call) so the response is
 * guaranteed-parseable structured data rather than prose to regex apart --
 * same approach as blendit-python/extraction/extract/llm_extract.py's
 * PLACES_TOOL, adapted for title/summary/locations instead of place
 * candidates.
 *
 * Wrapped in retry-with-backoff: Claude frequently returns transient
 * 429/5xx/529 ("overloaded") errors that clear within seconds, and this is
 * a multi-image request that's expensive to redo from scratch on a whim.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic } from "./client.js";
import { config } from "../config.js";
import { ClaudeAnalysisError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import type { VideoAnalysis } from "../types.js";

/** What Claude itself produces -- thumbnailUrl is added separately by uploadThumbnail.ts in claude/index.ts, not by this call. */
type ClaudeAnalysis = Omit<VideoAnalysis, "thumbnailUrl">;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const MAX_ATTEMPTS = 5;

const SYSTEM_PROMPT = `You extract structured information from short-form social videos (TikTok, Instagram Reels) using their caption text and a handful of frames sampled evenly across the video. You are precise: only record what's actually visible in the frames or stated in the caption. Do not invent information that isn't supported by what you're given, and clearly say when a name, location, or detail is uncertain. The frames are a representative sample, not the complete video -- treat them accordingly.`;

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "record_analysis",
  description:
    "Record a title, summary, and every distinct real-world place recognizable from the caption or the sampled video frames.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          'A short, punchy label for this clip (5-8 words), in the style of "Golden Gai bar crawl, 6 tiny bars" -- specific, not generic.',
      },
      summary: {
        type: "string",
        description:
          'ONE sentence, two at most. Describe the thing itself, not the video -- e.g. "Moe\'s halal cart selling $5 shawarma plates near Times Square," not "This video shows a reviewer visiting a halal cart." Never start with "This video" / "This clip" / "The video shows." Lead with the place, dish, or recommendation and its most compelling detail (price, rating, what makes it worth going).',
      },
      locations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The place or business name, e.g. \"Moe Eats NYC\" or \"Golden Gai\".",
            },
            category: {
              type: "string",
              description: 'Short 1-3 word category, e.g. "Food cart", "Bar", "Bar district", "Restaurant".',
            },
            address: {
              type: "string",
              description:
                "A street address for THIS place, only if the caption or on-screen text actually gives one -- omit rather than guess. Small/informal businesses often aren't findable by name alone, but a real address geocodes reliably, so include one whenever you have it.",
            },
          },
          required: ["name"],
        },
        description:
          "Every distinct place shown or named -- if this is a \"top 10\" or roundup video, list ALL of them (all 10), not just the first or most prominent. One entry per place, most confident first. Empty array if none are identifiable.",
      },
    },
    required: ["title", "summary", "locations"],
  },
};

const PlaceCandidateSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  address: z.string().optional(),
});

const ResponseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  locations: z.array(PlaceCandidateSchema),
});

function imagesToBlocks(images: Buffer[]): Anthropic.ImageBlockParam[] {
  return images.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") },
  }));
}

/**
 * `images` is either a handful of frames sampled evenly across a video, or
 * (for a photo/slideshow post with no video track at all -- see
 * claude/index.ts's analyzeSocialPhotoPost()) a single cover image. Either
 * way this function just describes them generically in the prompt rather
 * than assuming "frames from a video".
 */
export async function analyzeVideo(images: Buffer[], caption: string | undefined): Promise<ClaudeAnalysis> {
  const imageBlocks = imagesToBlocks(images);
  const captionText = caption?.trim() ? `Caption: "${caption.trim()}"` : "Caption: (none provided)";
  const frameNote =
    imageBlocks.length > 0
      ? `${imageBlocks.length} image(s) from the post are attached below (either frames sampled across a video, or a single cover photo for a photo/slideshow post).`
      : "No images are available -- work from the caption alone.";

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "record_analysis" },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `${captionText}\n\n${frameNote}` }, ...imageBlocks],
      },
    ],
  };

  let response: Anthropic.Message | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await anthropic.messages.create(request);
      break;
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      const retryable = status !== undefined && RETRYABLE_STATUS.has(status);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new ClaudeAnalysisError(`Claude analysis failed after ${attempt} attempt(s): ${detail}`);
      }
      const backoffMs = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, 16s
      logger.info(
        `Claude returned ${status} (transient); retrying in ${backoffMs / 1000}s ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS - 1})...`,
      );
      await sleep(backoffMs);
    }
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "record_analysis",
  );
  if (!toolUse) {
    throw new ClaudeAnalysisError("Claude did not call record_analysis as required.");
  }

  const validated = ResponseSchema.safeParse(toolUse.input);
  if (!validated.success) {
    throw new ClaudeAnalysisError(`Claude's response didn't match the expected shape: ${validated.error.message}`);
  }

  return validated.data;
}
