import { supabase } from './supabase';

export type ItineraryStop = {
  time: string;
  title: string;
  description: string;
  placeId?: string;
};

export type ItineraryDay = {
  date: string;
  stops: ItineraryStop[];
};

export type TripItinerary = {
  id: string;
  trip_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  wake_time: string;
  sleep_time: string;
  days: ItineraryDay[] | null;
  error_message: string | null;
  updated_at: string;
};

async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  return user;
}

export async function getItinerary(tripId: string): Promise<TripItinerary | null> {
  const { data, error } = await supabase.from('trip_itineraries').select('*').eq('trip_id', tripId).maybeSingle();
  if (error) throw error;
  return data;
}

// One plan per trip — (re)requesting always resets it to 'pending' so the
// worker picks up a fresh one, whether this is the first request or a redo.
// wakeTime/sleepTime ('HH:MM', 24-hour) become that day's start/end bounds
// for every day of the trip, replacing the old hardcoded 9am-11pm window.
export async function requestItinerary(tripId: string, wakeTime: string, sleepTime: string): Promise<void> {
  const user = await getCurrentUser();
  const { error } = await supabase.from('trip_itineraries').upsert(
    {
      trip_id: tripId,
      status: 'pending',
      wake_time: wakeTime,
      sleep_time: sleepTime,
      requested_by: user.id,
      error_message: null,
      days: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'trip_id' }
  );
  if (error) throw error;
}

export async function deleteItinerary(tripId: string): Promise<void> {
  const { error } = await supabase.from('trip_itineraries').delete().eq('trip_id', tripId);
  if (error) throw error;
}
