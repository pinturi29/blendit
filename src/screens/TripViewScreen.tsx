import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { SlidingUnderlineTabs } from '../components/SlidingTabs';
import { TimeField } from '../components/TimeField';
import { Avatar, Button, DownIcon, TextField, TrashIcon, UpIcon } from '../components/ui';
import { emojiForCategory } from '../lib/categoryEmoji';
import {
  addClip,
  ClipWithVotes,
  listClipsWithVotes,
  listTripPlaces,
  PlaceWithVotes,
  removeClip,
  setVote,
} from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { deleteItinerary, getItinerary, requestItinerary, TripItinerary } from '../lib/itinerary';
import { getProfilesByIds, Profile } from '../lib/profile';
import { supabase } from '../lib/supabase';
import { getTripWithMembers, Trip, tripDisplayName } from '../lib/trips';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

type Tab = 'blend' | 'itinerary' | 'plan';

function timeAgo(iso: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatDayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatStopTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return time;
  const period = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${minuteStr ?? '00'} ${period}`;
}

// The wake/sleep pickers work in Date objects (what DateTimePicker wants);
// only the HH:MM piece of them is meaningful, and that's all that's sent
// to/stored by the itinerary request.
function timeToHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function hhmmToTime(hhmm: string): Date {
  const [hour, minute] = hhmm.split(':').map((n) => parseInt(n, 10));
  const date = new Date();
  date.setHours(Number.isNaN(hour) ? 9 : hour, Number.isNaN(minute) ? 0 : minute, 0, 0);
  return date;
}

const DEFAULT_WAKE_TIME = '09:00';
const DEFAULT_SLEEP_TIME = '23:00';

// Simple pulsing "Blending…" state shown wherever the itinerary is being
// (re)generated -- gives the async worker round-trip a visible heartbeat
// instead of a static spinner.
function BlendingIndicator() {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.blendingRow}>
      <ActivityIndicator size="small" color={colors.white} />
      <Animated.Text style={[styles.planBtnText, { opacity: pulse }]}>Blending…</Animated.Text>
    </View>
  );
}

function ConsensusMeter({
  clip,
  partySize,
  onVote,
}: {
  clip: ClipWithVotes;
  partySize: number;
  onVote: (vote: 'up' | 'down') => void;
}) {
  const total = Math.max(partySize, clip.upCount + clip.downCount);
  const segments: Array<'up' | 'no' | 'empty'> = [
    ...Array(clip.upCount).fill('up' as const),
    ...Array(clip.downCount).fill('no' as const),
  ];
  while (segments.length < total) segments.push('empty');

  return (
    <View style={styles.meter}>
      <View style={styles.bars}>
        {segments.map((s, i) => (
          <View key={i} style={[styles.bar, s === 'up' && styles.barUp, s === 'no' && styles.barNo]} />
        ))}
      </View>
      <Text style={styles.tally}>
        {clip.upCount}/{total}
      </Text>
      <View style={styles.votes}>
        <Pressable style={[styles.vb, clip.myVote === 'up' && styles.vbOn]} onPress={() => onVote('up')}>
          <UpIcon color={clip.myVote === 'up' ? colors.white : colors.muted} />
        </Pressable>
        <Pressable style={[styles.vb, clip.myVote === 'down' && styles.vbOff]} onPress={() => onVote('down')}>
          <DownIcon color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

type ItineraryPlace = PlaceWithVotes & { clipId: string };

export function TripViewScreen({
  tripId,
  onBack,
  onOpenClip,
  onViewOnMap,
}: {
  tripId: string;
  onBack: () => void;
  onOpenClip: (clipId: string) => void;
  onViewOnMap: (tripId: string, placeId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('blend');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [clips, setClips] = useState<ClipWithVotes[]>([]);
  const [places, setPlaces] = useState<ItineraryPlace[]>([]);
  const [sharerProfiles, setSharerProfiles] = useState<Record<string, Profile>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);

  const [itinerary, setItinerary] = useState<TripItinerary | null>(null);
  const [isRequestingItinerary, setIsRequestingItinerary] = useState(false);
  const [isDeletingItinerary, setIsDeletingItinerary] = useState(false);
  const [wakeTime, setWakeTime] = useState(() => hhmmToTime(DEFAULT_WAKE_TIME));
  const [sleepTime, setSleepTime] = useState(() => hhmmToTime(DEFAULT_SLEEP_TIME));

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [{ trip: t }, clipsData, placesData, itineraryData] = await Promise.all([
        getTripWithMembers(tripId),
        listClipsWithVotes(tripId),
        listTripPlaces(tripId),
        getItinerary(tripId),
      ]);
      setTrip(t);
      setClips(clipsData);
      setPlaces(placesData);
      setItinerary(itineraryData);
      // Best-effort enrichment — a hiccup here shouldn't block the clips.
      const empty: Record<string, Profile> = {};
      setSharerProfiles(await getProfilesByIds(clipsData.map((clip) => clip.shared_by)).catch(() => empty));
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [tripId]);

  // Refetches every time this screen regains focus (not just on mount) --
  // otherwise coming back from ClipDetailScreen after voting a place up to
  // full consensus wouldn't show it on the Itinerary tab until some other
  // event happened to trigger a reload. Only the very first load shows the
  // full-screen spinner; later focus refreshes happen quietly.
  const hasLoadedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnceRef.current) setIsLoading(true);
      fetchAll().finally(() => {
        setIsLoading(false);
        hasLoadedOnceRef.current = true;
      });
    }, [fetchAll])
  );

  // Clips are inserted 'pending' and filled in later by the extraction
  // worker — this keeps the Blend tab live instead of needing a manual
  // pull-to-refresh once a clip finishes processing.
  useEffect(() => {
    const channelName = `trip-clips-${tripId}`;
    // Dev-mode Fast Refresh can leave a channel with this same name still
    // subscribed from a previous run of this effect (its cleanup didn't
    // get to run before the module re-evaluated) -- adding a listener to
    // an already-subscribed channel throws, so clear any leftover first.
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_clips', filter: `trip_id=eq.${tripId}` },
        () => {
          fetchAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, fetchAll]);

  // Same live-update need as clips above -- the plan goes pending ->
  // processing -> done/error on the worker's own time, not ours.
  useEffect(() => {
    const channelName = `trip-itinerary-${tripId}`;
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_itineraries', filter: `trip_id=eq.${tripId}` },
        () => {
          fetchAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, fetchAll]);

  // Reflect the trip's last-saved wake/sleep times once they load, so
  // reopening a trip that already picked non-default times shows those --
  // but only once, so it doesn't fight with the user actively adjusting the
  // pickers while a background refetch comes in.
  const hasInitializedTimesRef = useRef(false);
  useEffect(() => {
    if (hasInitializedTimesRef.current) return;
    if (itinerary?.wake_time && itinerary?.sleep_time) {
      setWakeTime(hhmmToTime(itinerary.wake_time));
      setSleepTime(hhmmToTime(itinerary.sleep_time));
      hasInitializedTimesRef.current = true;
    }
  }, [itinerary]);

  async function handleRequestItinerary() {
    setIsRequestingItinerary(true);
    try {
      await requestItinerary(tripId, timeToHHMM(wakeTime), timeToHHMM(sleepTime));
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsRequestingItinerary(false);
    }
  }

  async function handleDeleteItinerary() {
    setIsDeletingItinerary(true);
    try {
      await deleteItinerary(tripId);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsDeletingItinerary(false);
    }
  }

  function confirmDeleteItinerary() {
    Alert.alert('Delete this plan?', "This clears the full day plan for everyone on the trip. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete plan', style: 'destructive', onPress: handleDeleteItinerary },
    ]);
  }

  async function handleVote(clipId: string, vote: 'up' | 'down') {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    try {
      await setVote(clipId, vote, clip.myVote);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function handleDeleteClip(clipId: string) {
    setDeletingClipId(clipId);
    try {
      await removeClip(clipId);
      await fetchAll();
    } catch (e) {
      Alert.alert('Could not delete this clip', getErrorMessage(e));
    } finally {
      setDeletingClipId(null);
    }
  }

  function confirmDeleteClip(clipId: string) {
    Alert.alert(
      'Delete this clip?',
      "This removes it — and everything extracted from it — for everyone on the trip. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete clip', style: 'destructive', onPress: () => handleDeleteClip(clipId) },
      ]
    );
  }

  async function handleShare() {
    if (!url.trim()) return;
    setIsSubmitting(true);
    try {
      await addClip(tripId, url);
      setUrl('');
      setIsAdding(false);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Same "everyone votes it up, no downvotes" bar the map pins use — the
  // itinerary is just a list view of the exact same approved places, so
  // every row here has a matching pin to jump to.
  const approvedPlaces = useMemo(
    () =>
      places
        .filter(
          (p) => p.lat != null && p.lng != null && p.downCount === 0 && p.upCount >= (trip?.party_size ?? 1)
        )
        .sort((a, b) => b.upCount - a.upCount),
    [places, trip]
  );

  // A clip's overall "Want this" vote doesn't mean much once it covers
  // several distinct spots (a "7 restaurants" clip) — those need their own
  // per-place vote instead, so the Blend tab points there rather than
  // showing the whole-clip meter.
  const placeCountByClip = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of places) {
      counts.set(place.clipId, (counts.get(place.clipId) ?? 0) + 1);
    }
    return counts;
  }, [places]);

  // Covers the whole span from tapping the button to a finished plan --
  // including the gap right after requesting, where the local
  // isRequestingItinerary flag has already reset (the insert itself
  // resolved) but the worker hasn't claimed the row yet, so its status is
  // still 'pending' rather than 'processing'. Without 'pending' here, the
  // spinner would flash off and the button text back on for a few seconds
  // in exactly that gap.
  const isGeneratingItinerary =
    isRequestingItinerary || itinerary?.status === 'pending' || itinerary?.status === 'processing';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {trip ? tripDisplayName(trip) : ''}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <SlidingUnderlineTabs
        equalWidth
        tabs={[
          { key: 'blend', label: 'Blend' },
          { key: 'itinerary', label: 'Itinerary' },
          { key: 'plan', label: 'Blendit!' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : (
        <DismissKeyboardView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {tab === 'blend' ? (
            <>
              {isAdding ? (
                <View style={styles.addCard}>
                  <TextField
                    label="Link"
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://tiktok.com/… or https://instagram.com/reel/…"
                    autoCapitalize="none"
                    autoFocus
                  />
                  <Text style={styles.addCardHint}>
                    We'll pull the title, a summary, and any location automatically.
                  </Text>
                  <View style={styles.addCardActions}>
                    <View style={styles.addCardActionFlex}>
                      <Button title="Cancel" variant="secondary" onPress={() => setIsAdding(false)} />
                    </View>
                    <View style={styles.addCardActionFlex}>
                      <Button
                        title="Share to trip"
                        onPress={handleShare}
                        loading={isSubmitting}
                        disabled={!url.trim()}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                <Button title="Share a clip" variant="secondary" onPress={() => setIsAdding(true)} />
              )}

              {clips.length === 0 && !isAdding ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>Nothing shared yet</Text>
                  <Text style={styles.emptyBody}>Paste a TikTok or Reels link to start the blend.</Text>
                </View>
              ) : (
                clips.map((clip) => (
                  <View key={clip.id} style={styles.clipCard}>
                    <Pressable onPress={() => onOpenClip(clip.id)}>
                      <View style={styles.clipTop}>
                        <Avatar uri={sharerProfiles[clip.shared_by]?.avatar_url ?? null} size={24} />
                        <Text style={styles.clipSharerName}>
                          {sharerProfiles[clip.shared_by]?.full_name ?? 'Someone'}
                        </Text>
                        <Text style={styles.clipTime}>{timeAgo(clip.created_at)}</Text>
                        <Text style={styles.clipSource}>{clip.source}</Text>
                        <Pressable
                          onPress={() => confirmDeleteClip(clip.id)}
                          disabled={deletingClipId === clip.id}
                          hitSlop={8}
                          style={styles.clipDeleteBtn}
                        >
                          {deletingClipId === clip.id ? (
                            <ActivityIndicator size="small" color={colors.muted} />
                          ) : (
                            <TrashIcon color={colors.muted} size={15} />
                          )}
                        </Pressable>
                      </View>
                      {clip.status === 'pending' || clip.status === 'processing' ? (
                        <View style={styles.processingRow}>
                          <ActivityIndicator size="small" color={colors.mutedSoft} />
                          <Text style={styles.processingText}>Processing…</Text>
                        </View>
                      ) : clip.status === 'error' ? (
                        <Text style={styles.clipError}>
                          {clip.error_message ?? "Couldn't process this clip."}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.clipTitle}>{clip.title}</Text>
                          {clip.summary ? <Text style={styles.clipBody}>{clip.summary}</Text> : null}
                        </>
                      )}
                    </Pressable>
                    {clip.status === 'done' &&
                      ((placeCountByClip.get(clip.id) ?? 0) > 1 ? (
                        <Pressable style={styles.voteLocationsBtn} onPress={() => onOpenClip(clip.id)}>
                          <Text style={styles.voteLocationsBtnText}>Vote on locations</Text>
                          <Text style={styles.voteLocationsChevron}>›</Text>
                        </Pressable>
                      ) : (
                        <ConsensusMeter
                          clip={clip}
                          partySize={trip?.party_size ?? 1}
                          onVote={(vote) => handleVote(clip.id, vote)}
                        />
                      ))}
                  </View>
                ))
              )}
            </>
          ) : tab === 'itinerary' ? (
            approvedPlaces.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing's cleared the vote yet</Text>
                <Text style={styles.emptyBody}>
                  Once everyone in the group votes a place up with no downvotes, it lands here.
                </Text>
              </View>
            ) : (
              approvedPlaces.map((place) => (
                <Pressable key={place.id} style={styles.stopCard} onPress={() => onViewOnMap(tripId, place.id)}>
                  <View style={styles.stopSquare}>
                    <Text style={styles.stopSquareEmoji}>{emojiForCategory(place.category)}</Text>
                  </View>
                  <View style={styles.stopInfo}>
                    <Text style={styles.stopTitle}>{place.name}</Text>
                    <Text style={styles.stopMeta} numberOfLines={1}>
                      {[place.category, place.location_name].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.stopBadge}>
                    {place.upCount}/{Math.max(trip?.party_size ?? 1, place.upCount + place.downCount)}
                  </Text>
                </Pressable>
              ))
            )
          ) : (
            <>
              <View style={styles.timeRow}>
                <TimeField label="Wake up" value={wakeTime} onChange={setWakeTime} />
                <TimeField label="Asleep by" value={sleepTime} onChange={setSleepTime} />
              </View>

              {!isGeneratingItinerary && itinerary?.status === 'done' && itinerary.days && itinerary.days.length > 0 ? (
                <>
                  <View style={styles.planHeaderRow}>
                    <Text style={styles.planHeaderTitle}>Your full day plan</Text>
                    <View style={styles.planHeaderActions}>
                      <Pressable onPress={handleRequestItinerary} disabled={isDeletingItinerary} hitSlop={8}>
                        <Text style={styles.regenerateLink}>Regenerate</Text>
                      </Pressable>
                      <Pressable onPress={confirmDeleteItinerary} disabled={isDeletingItinerary} hitSlop={8}>
                        <Text style={styles.deletePlanLink}>{isDeletingItinerary ? 'Deleting…' : 'Delete'}</Text>
                      </Pressable>
                    </View>
                  </View>
                  {itinerary.days.map((day) => (
                    <View key={day.date} style={styles.dayBlock}>
                      <Text style={styles.dayHeader}>{formatDayLabel(day.date)}</Text>
                      {day.stops.map((stop, i) => (
                        <View key={i} style={styles.planStopRow}>
                          <Text style={styles.planStopTime}>{formatStopTime(stop.time)}</Text>
                          <View style={styles.planStopInfo}>
                            <Text style={styles.planStopTitle}>{stop.title}</Text>
                            <Text style={styles.planStopDesc}>{stop.description}</Text>
                            <Text style={styles.stopSourceTag}>{stop.placeId ? 'From Blend' : '✨ Suggested'}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Pressable style={styles.planBtn} onPress={handleRequestItinerary} disabled={isGeneratingItinerary}>
                    {isGeneratingItinerary ? <BlendingIndicator /> : <Text style={styles.planBtnText}>✨ Plan my day</Text>}
                  </Pressable>
                  {itinerary?.status === 'error' && (
                    <Text style={styles.error}>{itinerary.error_message ?? "Couldn't build the plan."}</Text>
                  )}
                  <Text style={styles.emptyBody}>
                    Builds a full day-by-day schedule from your wake-up to your sleep time, using your group's
                    approved spots — Claude fills in the rest if you don't have enough yet.
                  </Text>
                </>
              )}
            </>
          )}
        </ScrollView>
        </DismissKeyboardView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  back: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    color: colors.navy,
    width: 32,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    color: colors.text,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginBottom: spacing.lg,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    textAlign: 'center',
  },
  addCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 13,
    marginBottom: spacing.lg,
  },
  addCardHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  addCardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addCardActionFlex: {
    flex: 1,
  },
  clipCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 13,
    marginTop: spacing.lg,
  },
  clipTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  clipSharerName: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    color: colors.text,
  },
  clipTime: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.mutedSoft,
  },
  clipSource: {
    marginLeft: 'auto',
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 5,
  },
  clipDeleteBtn: {
    marginLeft: spacing.sm,
  },
  clipTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 19,
    color: colors.text,
  },
  clipBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.smd,
    lineHeight: 18,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  processingText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.smd,
    color: colors.mutedSoft,
  },
  clipError: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.smd,
    color: '#C23B3B',
  },
  meter: {
    marginTop: spacing.lg,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  voteLocationsBtn: {
    marginTop: spacing.lg,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  voteLocationsBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.blue,
  },
  voteLocationsChevron: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.blue,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
  },
  bar: {
    height: 5,
    flex: 1,
    borderRadius: 1,
    backgroundColor: colors.line,
  },
  barUp: {
    backgroundColor: colors.blue,
  },
  barNo: {
    backgroundColor: colors.line,
    borderWidth: 1,
    borderColor: colors.chip,
  },
  tally: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.navy,
  },
  votes: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  vb: {
    width: 34,
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vbOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  vbOff: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  planBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radii.md,
    paddingVertical: 13,
    marginBottom: spacing.lg,
  },
  planBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.base,
    color: colors.white,
  },
  blendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  planHeaderTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text,
  },
  planHeaderActions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  regenerateLink: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.blue,
  },
  deletePlanLink: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: '#C23B3B',
  },
  dayBlock: {
    marginBottom: spacing.xl,
  },
  dayHeader: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.navy,
    marginBottom: spacing.sm,
  },
  planStopRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  planStopTime: {
    width: 68,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  planStopInfo: {
    flex: 1,
  },
  planStopTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.smd,
    color: colors.text,
  },
  planStopDesc: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  stopSourceTag: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.xs,
    color: colors.blue,
    marginTop: 2,
  },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 11,
    marginTop: spacing.md,
  },
  stopSquare: {
    width: 40,
    height: 40,
    borderRadius: 7,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquareEmoji: {
    fontSize: 19,
  },
  stopInfo: {
    flex: 1,
  },
  stopTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.smd,
    color: colors.text,
  },
  stopMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  stopBadge: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xs,
    color: colors.navy,
    backgroundColor: colors.fill,
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 5,
  },
});
