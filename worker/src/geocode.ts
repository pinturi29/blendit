/**
 * Turns place candidates (as recognized by Claude in claude/analyzeVideo.ts)
 * into map coordinates, via Google's Places API (Find Place From Text).
 * Replaces the free Nominatim/OpenStreetMap search this used to run on --
 * confirmed directly: the exact "Moe Eats NYC" business name that once got
 * misgeocoded to a same-named business in St. Louis via Nominatim now
 * resolves correctly on the first try, no address fallback needed.
 */
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import type { GeocodedPlace, PlaceCandidate } from "./types.js";

interface GoogleFindPlaceCandidate {
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
}

interface GoogleFindPlaceResponse {
  candidates: GoogleFindPlaceCandidate[];
  status: string;
  error_message?: string;
}

interface GeocodeHit {
  shortLocation: string;
  lat: number;
  lng: number;
}

/** Nudges Google's results toward a trip's own destination -- without this, a chain like "The Halal Guys" (which has locations in many cities) can resolve to the wrong branch entirely. */
export interface LocationBias {
  lat: number;
  lng: number;
}

/** A soft preference, not a hard filter -- Google will still return a match outside this radius if nothing better exists inside it. 50km comfortably covers a destination's metro area without being so wide it stops disambiguating anything. */
const BIAS_RADIUS_METERS = 50_000;

async function geocodeQuery(query: string, bias?: LocationBias): Promise<GeocodeHit | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("input", trimmed);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "name,geometry,formatted_address");
    url.searchParams.set("key", config.GOOGLE_PLACES_API_KEY);
    if (bias) {
      url.searchParams.set("locationbias", `circle:${BIAS_RADIUS_METERS}@${bias.lat},${bias.lng}`);
    }

    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`Geocoding "${trimmed}" failed: Google Places returned HTTP ${res.status}.`);
      return null;
    }

    const data = (await res.json()) as GoogleFindPlaceResponse;
    if (data.status !== "OK") {
      if (data.status !== "ZERO_RESULTS") {
        const detail = data.error_message ? ` (${data.error_message})` : "";
        logger.warn(`Geocoding "${trimmed}" failed: Google Places status ${data.status}${detail}.`);
      }
      return null;
    }

    const first = data.candidates[0];
    const location = first?.geometry?.location;
    if (!first || !location) return null;

    return {
      shortLocation: first.formatted_address ?? first.name ?? trimmed,
      lat: location.lat,
      lng: location.lng,
    };
  } catch (err) {
    logger.warn(`Geocoding "${trimmed}" failed: ${(err as Error).message}.`);
    return null;
  }
}

/**
 * Geocodes every distinct place Claude found. Each candidate is kept in the
 * result even if geocoding fails -- it just comes back with null
 * lat/lng/shortLocation, so the UI can still list it as "not confirmed"
 * rather than silently dropping it.
 *
 * Tries the address first (if Claude found one) since a real street address
 * is unambiguous by construction, and only falls back to the bare name --
 * still far more reliable on Google than it was on Nominatim, but a name
 * alone can occasionally collide with an unrelated same-named business
 * elsewhere, which a real address never does.
 *
 * No artificial rate-limit delay between calls (unlike the old Nominatim
 * version) -- this is a paid, per-project quota, not a shared community
 * resource with a request-rate etiquette policy to respect.
 *
 * `bias` is the trip's own destination coordinates, when known -- passed
 * through to every query so a chain/franchise name resolves to the branch
 * actually near the trip, not just Google's globally top-ranked match.
 */
export async function geocodePlaces(candidates: PlaceCandidate[], bias?: LocationBias): Promise<GeocodedPlace[]> {
  const results: GeocodedPlace[] = [];

  for (const candidate of candidates) {
    let hit = candidate.address ? await geocodeQuery(candidate.address, bias) : null;
    if (!hit) {
      hit = await geocodeQuery(candidate.name, bias);
    }

    results.push({
      name: candidate.name,
      category: candidate.category ?? null,
      shortLocation: hit?.shortLocation ?? null,
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
    });
  }

  return results;
}
