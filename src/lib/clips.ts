import { supabase } from './supabase';
import { Trip } from './trips';

export type ClipSource = 'TikTok' | 'Instagram Reels';

export type TripClip = {
  id: string;
  trip_id: string;
  shared_by: string;
  source: ClipSource;
  url: string;
  title: string;
  description: string | null;
  created_at: string;
};

export type ClipVote = {
  id: string;
  clip_id: string;
  user_id: string;
  vote: 'up' | 'down';
  created_at: string;
};

export type ClipWithVotes = TripClip & {
  votes: ClipVote[];
  myVote: 'up' | 'down' | null;
  upCount: number;
  downCount: number;
};

async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  return user;
}

export async function listClipsWithVotes(tripId: string): Promise<ClipWithVotes[]> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_clips')
    .select('*, trip_clip_votes(*)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { trip_clip_votes: votes, ...clip } = row;
    const mine = (votes as ClipVote[]).find((v) => v.user_id === user.id) ?? null;
    return {
      ...(clip as TripClip),
      votes: votes as ClipVote[],
      myVote: mine?.vote ?? null,
      upCount: (votes as ClipVote[]).filter((v) => v.vote === 'up').length,
      downCount: (votes as ClipVote[]).filter((v) => v.vote === 'down').length,
    };
  });
}

export async function addClip(
  tripId: string,
  input: { source: ClipSource; url: string; title: string; description: string }
): Promise<TripClip> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_clips')
    .insert({
      trip_id: tripId,
      shared_by: user.id,
      source: input.source,
      url: input.url.trim(),
      title: input.title.trim(),
      description: input.description.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function countMySharedClips(): Promise<number> {
  const user = await getCurrentUser();
  const { count, error } = await supabase
    .from('trip_clips')
    .select('id', { count: 'exact', head: true })
    .eq('shared_by', user.id);
  if (error) throw error;
  return count ?? 0;
}

export async function countMySharedReels(): Promise<number> {
  const user = await getCurrentUser();
  const { count, error } = await supabase
    .from('trip_clips')
    .select('id', { count: 'exact', head: true })
    .eq('shared_by', user.id)
    .eq('source', 'Instagram Reels');
  if (error) throw error;
  return count ?? 0;
}

export async function removeClip(clipId: string): Promise<void> {
  const { error } = await supabase.from('trip_clips').delete().eq('id', clipId);
  if (error) throw error;
}

// Tapping the vote you already cast clears it; tapping the other flips it.
export async function setVote(clipId: string, vote: 'up' | 'down', currentVote: 'up' | 'down' | null) {
  const user = await getCurrentUser();

  if (currentVote === vote) {
    const { error } = await supabase
      .from('trip_clip_votes')
      .delete()
      .eq('clip_id', clipId)
      .eq('user_id', user.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('trip_clip_votes')
    .upsert({ clip_id: clipId, user_id: user.id, vote }, { onConflict: 'clip_id,user_id' });
  if (error) throw error;
}

export type PendingVoteSummary = {
  trip: Trip;
  clips: TripClip[];
};

// One query across every clip on every trip visible to me (RLS already
// scopes that), grouped client-side by trip — avoids an N+1 query per trip.
export async function listPendingVotesByTrip(): Promise<PendingVoteSummary[]> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_clips')
    .select('*, trip_clip_votes(*), trips(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const byTrip = new Map<string, PendingVoteSummary>();
  for (const row of data ?? []) {
    const { trip_clip_votes: votes, trips: trip, ...clip } = row;
    if (!trip) continue;
    const alreadyVoted = (votes as ClipVote[]).some((v) => v.user_id === user.id);
    if (alreadyVoted) continue;

    if (!byTrip.has(trip.id)) byTrip.set(trip.id, { trip: trip as Trip, clips: [] });
    byTrip.get(trip.id)!.clips.push(clip as TripClip);
  }

  return Array.from(byTrip.values());
}
