import { supabase } from './supabase';

export type Trip = {
  id: string;
  owner_id: string;
  destination: string;
  name: string | null;
  cover_photo_url: string | null;
  lat: number | null;
  lng: number | null;
  // Where the group is actually staying (hotel/Airbnb address) — distinct
  // from lat/lng above, which is just the general destination.
  home_base_label: string | null;
  home_base_lat: number | null;
  home_base_lng: number | null;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  party_size: number;
  description: string | null;
  created_at: string;
};

// A trip's display title — the custom name if the owner set one, else the
// destination. Use this everywhere a trip's "title" is shown.
export function tripDisplayName(trip: Trip): string {
  return trip.name?.trim() ? trip.name : trip.destination;
}

export type TripInvite = {
  id: string;
  trip_id: string;
  email: string;
  status: 'invited' | 'joined';
  invited_by: string;
  created_at: string;
};

export type NewTripInput = {
  destination: string;
  name: string;
  lat: number | null;
  lng: number | null;
  homeBaseLabel?: string;
  homeBaseLat?: number | null;
  homeBaseLng?: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  partySize: number;
  description: string;
  inviteEmails: string[];
};

export type TripStop = {
  id: string;
  trip_id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  created_by: string;
  created_at: string;
};

async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  return user;
}

// Trips I own, plus trips I've accepted an invite to. RLS on `trips`
// already restricts visible rows to "owner or invited (any status)", and
// RLS on the embedded `trip_invites` restricts those to just my own
// invite row when I'm not the owner — so this filter is really just
// picking out "joined" among what's already visible to me.
export async function listMyTrips(): Promise<Trip[]> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trips')
    .select('*, trip_invites(email, status)')
    .order('start_date', { ascending: true });

  if (error) throw error;

  return (data ?? [])
    .filter(
      (t) =>
        t.owner_id === user.id ||
        t.trip_invites.some((i: { email: string; status: string }) => i.email === user.email && i.status === 'joined')
    )
    .map(({ trip_invites: _tripInvites, ...trip }) => trip as Trip);
}

// Trips I've been invited to but haven't accepted or declined yet.
export async function listPendingInvites(): Promise<Array<{ invite: TripInvite; trip: Trip }>> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_invites')
    .select('*, trips(*)')
    .eq('email', user.email)
    .eq('status', 'invited');

  if (error) throw error;

  return (data ?? [])
    .filter((row) => row.trips)
    .map((row) => {
      const { trips: trip, ...invite } = row;
      return { invite: invite as TripInvite, trip: trip as Trip };
    });
}

export async function acceptInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_invites')
    .update({ status: 'joined' })
    .eq('id', inviteId);
  if (error) throw error;
}

// Used both for declining your own invite and (by the trip owner) for
// removing someone else's — RLS on trip_invites decides which is allowed.
export async function removeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from('trip_invites').delete().eq('id', inviteId);
  if (error) throw error;
}

export async function getTripWithMembers(
  tripId: string
): Promise<{ trip: Trip; members: TripInvite[] }> {
  const { data, error } = await supabase
    .from('trips')
    .select('*, trip_invites(*)')
    .eq('id', tripId)
    .single();

  if (error) throw error;
  const { trip_invites: members, ...trip } = data;
  return { trip: trip as Trip, members: (members ?? []) as TripInvite[] };
}

// Deleting the trip cascades to trip_invites (on delete cascade in the
// schema), so every member loses access at once.
export async function deleteTrip(tripId: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) throw error;
}

// Empty string clears the custom name, falling back to destination again.
export async function updateTripName(tripId: string, name: string): Promise<void> {
  const { error } = await supabase.from('trips').update({ name: name.trim() || null }).eq('id', tripId);
  if (error) throw error;
}

// startDate/endDate are 'YYYY-MM-DD', same format the row already stores.
export async function updateTripDates(tripId: string, startDate: string, endDate: string): Promise<void> {
  const { error } = await supabase.from('trips').update({ start_date: startDate, end_date: endDate }).eq('id', tripId);
  if (error) throw error;
}

// Pass null to clear the home base entirely.
export async function updateHomeBase(
  tripId: string,
  place: { label: string; lat: number | null; lng: number | null } | null
): Promise<void> {
  const { error } = await supabase
    .from('trips')
    .update({
      home_base_label: place?.label.trim() || null,
      home_base_lat: place?.lat ?? null,
      home_base_lng: place?.lng ?? null,
    })
    .eq('id', tripId);
  if (error) throw error;
}

// Extra locations attached to a trip — shown only on the trip detail
// screen, never changes trips.destination (the main title on Home).
export async function listTripStops(tripId: string): Promise<TripStop[]> {
  const { data, error } = await supabase
    .from('trip_stops')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addTripStop(
  tripId: string,
  place: { label: string; lat: number | null; lng: number | null }
): Promise<TripStop> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_stops')
    .insert({
      trip_id: tripId,
      label: place.label,
      lat: place.lat,
      lng: place.lng,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeTripStop(stopId: string): Promise<void> {
  const { error } = await supabase.from('trip_stops').delete().eq('id', stopId);
  if (error) throw error;
}

export async function createTripWithInvites(input: NewTripInput): Promise<Trip> {
  const user = await getCurrentUser();

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .insert({
      owner_id: user.id,
      destination: input.destination,
      name: input.name.trim() || null,
      lat: input.lat,
      lng: input.lng,
      home_base_label: input.homeBaseLabel?.trim() || null,
      home_base_lat: input.homeBaseLat ?? null,
      home_base_lng: input.homeBaseLng ?? null,
      start_date: input.startDate,
      end_date: input.endDate,
      party_size: input.partySize,
      description: input.description || null,
    })
    .select()
    .single();

  if (tripError) throw tripError;

  const emails = input.inviteEmails.map((e) => e.trim()).filter(Boolean);
  if (emails.length > 0) {
    const { error: inviteError } = await supabase.from('trip_invites').insert(
      emails.map((email) => ({
        trip_id: trip.id,
        email,
        invited_by: user.id,
      }))
    );
    if (inviteError) throw inviteError;
  }

  return trip;
}

export function nightsBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}
