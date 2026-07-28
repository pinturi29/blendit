/**
 * Runs one claimed trip_itineraries row: loads the trip's unanimously-
 * approved places (same bar the map/itinerary already use), trims to the
 * top-voted ones if there are more than a day-by-day plan could reasonably
 * hold, and asks Claude to build the full schedule between the group's
 * chosen wake-up/sleep times. Used by src/worker.ts's itinerary poll loop.
 */
import { generateItinerary } from "../itinerary/generateItinerary.js";
import { supabase } from "../supabase/client.js";
import { logger } from "../utils/logger.js";
import { isAppError } from "../utils/errors.js";
import type { ItineraryJob } from "../types.js";

// ~5 stops/day is a realistic ceiling for a waking day once meals and
// travel time are accounted for -- if the group approved more than that,
// the highest-voted ones (sorted below) win and the rest are dropped.
const STOPS_PER_DAY_CAPACITY = 5;

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.length > 0 ? dates : [startDate];
}

async function markError(jobId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("trip_itineraries")
    .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) {
    logger.error(`Failed to mark itinerary job ${jobId} as errored: ${error.message}`);
  }
}

export async function processItineraryJob(job: ItineraryJob): Promise<void> {
  logger.info(`Processing itinerary job ${job.id} (trip ${job.trip_id})`);

  try {
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("destination, start_date, end_date, party_size")
      .eq("id", job.trip_id)
      .single();
    if (tripError || !trip) throw new Error(`Could not load trip: ${tripError?.message ?? "not found"}`);

    const { data: placeRows, error: placesError } = await supabase
      .from("clip_places")
      .select("id, name, category, location_name, lat, lng, clip_place_votes(vote), trip_clips!inner(trip_id)")
      .eq("trip_clips.trip_id", job.trip_id);
    if (placesError) throw new Error(`Could not load places: ${placesError.message}`);

    // Same "everyone voted it up, no downvotes" bar the map/itinerary
    // already use -- this plan only draws from places the whole group
    // actually wants, not just popular-so-far ones.
    const approved = (placeRows ?? [])
      .map((row) => {
        const votes = (row.clip_place_votes ?? []) as Array<{ vote: string }>;
        return {
          id: row.id as string,
          name: row.name as string,
          category: row.category as string | null,
          locationName: row.location_name as string | null,
          hasLocation: row.lat != null && row.lng != null,
          upCount: votes.filter((v) => v.vote === "up").length,
          downCount: votes.filter((v) => v.vote === "down").length,
        };
      })
      .filter((p) => p.hasLocation && p.downCount === 0 && p.upCount >= trip.party_size)
      .sort((a, b) => b.upCount - a.upCount);

    const dates = datesBetween(trip.start_date, trip.end_date);
    const capacity = dates.length * STOPS_PER_DAY_CAPACITY;
    const trimmed = approved.slice(0, capacity).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      locationName: p.locationName,
    }));

    const days = await generateItinerary({
      destination: trip.destination,
      dates,
      partySize: trip.party_size,
      places: trimmed,
      wakeTime: job.wake_time,
      sleepTime: job.sleep_time,
    });

    const { error: updateError } = await supabase
      .from("trip_itineraries")
      .update({ status: "done", days, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    if (updateError) throw new Error(`Failed to save itinerary: ${updateError.message}`);

    logger.success(`Itinerary job ${job.id} done: ${days.length} day(s), ${trimmed.length}/${approved.length} approved place(s) used.`);
  } catch (err) {
    const message = isAppError(err) ? err.message : err instanceof Error ? err.message : String(err);
    logger.error(`Itinerary job ${job.id} failed: ${message}`);
    await markError(job.id, message);
  }
}
