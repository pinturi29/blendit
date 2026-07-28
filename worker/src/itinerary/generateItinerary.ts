/**
 * Turns a trip's unanimously-approved places into a full day-by-day plan,
 * from the group's chosen wake-up time to their chosen sleep time, every
 * day of the trip -- using Claude to schedule them at sensible times (a
 * coffee shop in the morning, a bar in the evening, that kind of judgment)
 * and, since a group rarely approves exactly enough places to fill every
 * day, to invent well-known, plausible stops for the destination to round
 * out any day that's short. Mirrors the tool-use pattern in
 * claude/analyzeVideo.ts -- forcing a single structured tool call instead
 * of parsing prose.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic } from "../claude/client.js";
import { config } from "../config.js";
import { ClaudeAnalysisError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

export interface ItineraryPlaceInput {
  id: string;
  name: string;
  category: string | null;
  locationName: string | null;
}

export interface ItineraryStop {
  time: string;
  title: string;
  description: string;
  placeId?: string;
}

export interface ItineraryDay {
  date: string;
  stops: ItineraryStop[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const MAX_ATTEMPTS = 5;

const SYSTEM_PROMPT = `You are planning a real, day-by-day itinerary for a group trip. You are precise and realistic: sensible pacing, sensible travel/meal timing, no invented details about the group's own approved places beyond what you're given. When you add a stop of your own (not one of the group's approved places), it must be a real, well-known, plausible place or activity for the destination -- never generic filler like "Explore the city" or "Free time".`;

const ITINERARY_TOOL: Anthropic.Tool = {
  name: "create_itinerary",
  description: "Create the full day-by-day itinerary, one entry per day of the trip.",
  input_schema: {
    type: "object",
    properties: {
      days: {
        type: "array",
        description: "Exactly one entry per date provided, in order, covering every date given.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, must exactly match one of the provided dates." },
            stops: {
              type: "array",
              description: "Ordered by time, earliest first. Spans roughly from the given wake-up time to the given sleep time.",
              items: {
                type: "object",
                properties: {
                  time: { type: "string", description: "24-hour HH:MM, between the given wake-up time and sleep time." },
                  title: { type: "string", description: "Short name of the stop/activity." },
                  description: {
                    type: "string",
                    description: "One short sentence: what happens here / why it's scheduled at this time.",
                  },
                  placeId: {
                    type: "string",
                    description:
                      "The id of the matching provided group-approved place, ONLY if this stop is one of them. Omit entirely for a stop you added yourself.",
                  },
                },
                required: ["time", "title", "description"],
              },
            },
          },
          required: ["date", "stops"],
        },
      },
    },
    required: ["days"],
  },
};

const ResponseSchema = z.object({
  days: z.array(
    z.object({
      date: z.string().min(1),
      stops: z.array(
        z.object({
          time: z.string().min(1),
          title: z.string().min(1),
          description: z.string().min(1),
          placeId: z.string().optional(),
        }),
      ),
    }),
  ),
});

export async function generateItinerary(params: {
  destination: string;
  dates: string[];
  partySize: number;
  places: ItineraryPlaceInput[];
  wakeTime: string;
  sleepTime: string;
}): Promise<ItineraryDay[]> {
  const placesText =
    params.places.length > 0
      ? params.places
          .map((p) => `- id=${p.id} | ${p.name}${p.category ? ` (${p.category})` : ""}${p.locationName ? ` -- ${p.locationName}` : ""}`)
          .join("\n")
      : "(none -- the group hasn't approved any places yet, invent the whole plan yourself)";

  const userMessage =
    `Destination: ${params.destination}\n` +
    `Group size: ${params.partySize}\n` +
    `Every day starts at ${params.wakeTime} (wake-up) and ends at ${params.sleepTime} (asleep) -- use this exact window for every date below, not 9am-11pm or any other default.\n` +
    `Dates to plan (one itinerary day each, in order): ${params.dates.join(", ")}\n\n` +
    `Group-approved places to schedule in (use every one of these somewhere in the plan):\n${placesText}\n\n` +
    `Build the full ${params.dates.length}-day plan now. If there aren't enough approved places to reasonably fill a day from ${params.wakeTime} to ${params.sleepTime}, add your own well-known, real suggestions for ${params.destination}. Spread the approved places across the days and times that make sense for what they are (breakfast/coffee spots in the morning, bars/dinner in the evening, etc.) rather than just filling days in the order given.`;

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [ITINERARY_TOOL],
    tool_choice: { type: "tool", name: "create_itinerary" },
    messages: [{ role: "user", content: userMessage }],
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
        throw new ClaudeAnalysisError(`Itinerary generation failed after ${attempt} attempt(s): ${detail}`);
      }
      const backoffMs = 2000 * 2 ** (attempt - 1);
      logger.info(`Claude returned ${status} (transient); retrying in ${backoffMs / 1000}s...`);
      await sleep(backoffMs);
    }
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "create_itinerary",
  );
  if (!toolUse) {
    throw new ClaudeAnalysisError("Claude did not call create_itinerary as required.");
  }

  const validated = ResponseSchema.safeParse(toolUse.input);
  if (!validated.success) {
    throw new ClaudeAnalysisError(`Claude's itinerary response didn't match the expected shape: ${validated.error.message}`);
  }

  return validated.data.days;
}
