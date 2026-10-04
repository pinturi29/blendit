import { supabase } from './supabase';
import { Trip } from './trips';

export type ClipSource = 'TikTok' | 'Instagram Reels';
export type ClipStatus = 'pending' | 'processing' | 'done' | 'error';

export type TripClip = {
  id: string;
  trip_id: string;
  shared_by: string;
  source: ClipSource;
  url: string;
  status: ClipStatus;
  // Filled in by the extraction worker once status is 'done' — empty while
  // pending/processing.
  title: string | null;
  description: string | null;
  summary: string | null;
  thumbnail_url: string | null;
  // The original creator's handle, e.g. "tokyofoodguide" — not the trip
  // member who shared it (that's shared_by).
  author: string | null;
  // Legacy single-location fields from before a clip could feature more
  // than one place — superseded by ClipPlace rows, kept only so old rows
  // aren't left with dangling data. Not written by the worker anymore.
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  error_message: string | null;
  created_at: string;
};

// One real-world place a clip features — a clip can have several (e.g. a
// "top 10 food spots" video), each independently voted on.
export type ClipPlace = {
  id: string;
  clip_id: string;
  name: string;
  category: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  rank: number;
  created_at: string;
};

export type ClipPlaceVote = {
  id: string;
  place_id: string;
  user_id: string;
  vote: 'up' | 'down';
  created_at: string;
};

export type PlaceWithVotes = ClipPlace & {
  votes: ClipPlaceVote[];
  myVote: 'up' | 'down' | null;
  upCount: number;
  downCount: number;
  voters: Voter[];
};

// A tapback on a clip's link in the trip's linked iMessage group chat
// (written by the worker's iMessage bridge -- see migration 0003).
export type ChatVote = {
  memberId: string;
  userId: string | null;
  // Phone number or email as Messages reports it; 'me' is the trip owner's
  // own Mac account (always has userId set).
  handle: string;
  kind: string;
  emoji: string | null;
  value: -1 | 0 | 1;
};

// One person's vote, from either the app or the group chat. Someone who
// voted both ways counts once, with their app vote winning -- the same rule
// the place_scores ranking uses, so the counts here always match it.
export type Voter = {
  key: string;
  userId: string | null;
  handle: string | null;
  vote: 'up' | 'down';
  via: 'app' | 'chat';
  reaction: string | null;
};

const TAPBACK_EMOJI: Record<string, string> = {
  love: '❤️',
  like: '👍',
  dislike: '👎',
  emphasize: '‼️',
};

function chatVoteReaction(v: ChatVote): string | null {
  return v.emoji ?? TAPBACK_EMOJI[v.kind] ?? null;
}

// "+15551234567" -> "(555) 123-4567"; anything else (international numbers,
// emails) is shown as-is.
export function formatHandle(handle: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(handle);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : handle;
}

function mergeVotes(appVotes: Array<{ user_id: string; vote: 'up' | 'down' }>, chatVotes: ChatVote[]) {
  const voters: Voter[] = appVotes.map((v) => ({
    key: `u:${v.user_id}`,
    userId: v.user_id,
    handle: null,
    vote: v.vote,
    via: 'app' as const,
    reaction: null,
  }));
  const seen = new Set(voters.map((v) => v.key));
  for (const c of chatVotes) {
    if (c.value === 0) continue;
    const key = c.userId ? `u:${c.userId}` : `m:${c.memberId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    voters.push({
      key,
      userId: c.userId,
      handle: c.handle,
      vote: c.value > 0 ? 'up' : 'down',
      via: 'chat',
      reaction: chatVoteReaction(c),
    });
  }
  return {
    voters,
    upCount: voters.filter((v) => v.vote === 'up').length,
    downCount: voters.filter((v) => v.vote === 'down').length,
  };
}

// Chat tapbacks for these clips, keyed by clip id. Empty for trips with no
// linked group chat.
async function fetchChatVotes(clipIds: string[]): Promise<Map<string, ChatVote[]>> {
  const byClip = new Map<string, ChatVote[]>();
  if (clipIds.length === 0) return byClip;
  const { data, error } = await supabase
    .from('chat_reactions')
    .select('clip_id, kind, emoji, value, chat_members(id, handle, user_id)')
    .in('clip_id', clipIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const member = row.chat_members as unknown as { id: string; handle: string; user_id: string | null } | null;
    if (!member) continue;
    const list = byClip.get(row.clip_id) ?? [];
    list.push({
      memberId: member.id,
      userId: member.user_id,
      handle: member.handle,
      kind: row.kind,
      emoji: row.emoji,
      value: row.value as ChatVote['value'],
    });
    byClip.set(row.clip_id, list);
  }
  return byClip;
}

const INSTAGRAM_HOSTNAMES = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const TIKTOK_HOSTNAMES = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

// A lightweight client-side check (same hostname allow-list the extraction
// backend itself uses) so a bad link is rejected immediately instead of
// only after the worker picks it up. The worker still does the fuller
// validation (path shape, short-link expansion) before spending Apify
// credits — this is just enough to classify + give instant feedback.
export function detectClipSource(rawUrl: string): ClipSource | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const hostname = url.hostname.toLowerCase();
  if (INSTAGRAM_HOSTNAMES.has(hostname)) return 'Instagram Reels';
  if (TIKTOK_HOSTNAMES.has(hostname)) return 'TikTok';
  return null;
}

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
  voters: Voter[];
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

  const chatVotes = await fetchChatVotes((data ?? []).map((row) => row.id as string));
  return (data ?? []).map((row) => {
    const { trip_clip_votes: votes, ...clip } = row;
    const mine = (votes as ClipVote[]).find((v) => v.user_id === user.id) ?? null;
    return {
      ...(clip as TripClip),
      votes: votes as ClipVote[],
      myVote: mine?.vote ?? null,
      ...mergeVotes(votes as ClipVote[], chatVotes.get(row.id as string) ?? []),
    };
  });
}

// A tapback on a clip in the group chat counts as that person's vote on
// every place in the clip, unless they voted on the place in the app.
function withPlaceVotes(
  place: ClipPlace & { clip_place_votes: ClipPlaceVote[] },
  userId: string,
  chatVotes: ChatVote[] = []
): PlaceWithVotes {
  const { clip_place_votes: votes, ...rest } = place;
  const mine = votes.find((v) => v.user_id === userId) ?? null;
  return {
    ...rest,
    votes,
    myVote: mine?.vote ?? null,
    ...mergeVotes(votes, chatVotes),
  };
}

// A single clip plus every place it features, each with its own vote
// tally — what the clip detail screen shows. Kept separate from
// listClipsWithVotes (which the Blend/Itinerary tabs use) so that list
// isn't burdened with a deep places+votes join it doesn't need.
export async function getClipDetail(
  clipId: string
): Promise<ClipWithVotes & { places: PlaceWithVotes[]; partySize: number }> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('trip_clips')
    .select('*, trip_clip_votes(*), clip_places(*, clip_place_votes(*)), trips(party_size)')
    .eq('id', clipId)
    .single();

  if (error) throw error;

  const { trip_clip_votes: votes, clip_places: places, trips: trip, ...clip } = data;
  const mine = (votes as ClipVote[]).find((v) => v.user_id === user.id) ?? null;
  const chatVotes = (await fetchChatVotes([clipId])).get(clipId) ?? [];
  return {
    ...(clip as TripClip),
    votes: votes as ClipVote[],
    myVote: mine?.vote ?? null,
    ...mergeVotes(votes as ClipVote[], chatVotes),
    partySize: (trip as { party_size: number } | null)?.party_size ?? 1,
    places: (places as Array<ClipPlace & { clip_place_votes: ClipPlaceVote[] }>)
      .map((p) => withPlaceVotes(p, user.id, chatVotes))
      .sort((a, b) => a.rank - b.rank),
  };
}

// Every place, across every clip on a trip, with its vote tally — the
// caller decides which ones count as "the group agreed," e.g. for map pins.
export async function listTripPlaces(tripId: string): Promise<Array<PlaceWithVotes & { clipId: string }>> {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('clip_places')
    .select('*, clip_place_votes(*), trip_clips!inner(id, trip_id)')
    .eq('trip_clips.trip_id', tripId);

  if (error) throw error;

  const chatVotes = await fetchChatVotes([...new Set((data ?? []).map((row) => row.trip_clips.id as string))]);
  return (data ?? []).map((row) => {
    const { trip_clips: parentClip, ...place } = row;
    return {
      ...withPlaceVotes(place, user.id, chatVotes.get(parentClip.id as string) ?? []),
      clipId: parentClip.id as string,
    };
  });
}

// Tapping the vote you already cast clears it; tapping the other flips it —
// same behavior as the clip-level setVote above.
export async function setPlaceVote(placeId: string, vote: 'up' | 'down', currentVote: 'up' | 'down' | null) {
  const user = await getCurrentUser();

  if (currentVote === vote) {
    const { error } = await supabase
      .from('clip_place_votes')
      .delete()
      .eq('place_id', placeId)
      .eq('user_id', user.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('clip_place_votes')
    .upsert({ place_id: placeId, user_id: user.id, vote }, { onConflict: 'place_id,user_id' });
  if (error) throw error;
}

// Just a link — source is auto-detected, and title/description/summary/
// coordinates are filled in later by the extraction worker (status starts
// 'pending').
export async function addClip(tripId: string, url: string): Promise<TripClip> {
  const user = await getCurrentUser();
  const trimmedUrl = url.trim();
  const source = detectClipSource(trimmedUrl);
  if (!source) throw new Error('Paste a public TikTok or Instagram Reels link.');

  const { data, error } = await supabase
    .from('trip_clips')
    .insert({
      trip_id: tripId,
      shared_by: user.id,
      source,
      url: trimmedUrl,
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
    // Nothing to vote on until the worker has actually produced a
    // title/summary for it.
    .eq('status', 'done')
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
