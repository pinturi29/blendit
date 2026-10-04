import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { DownIcon, UpIcon } from '../components/ui';
import { ClipWithVotes, formatHandle, getClipDetail, PlaceWithVotes, setPlaceVote, setVote, Voter } from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { getProfilesByIds, Profile } from '../lib/profile';
import { supabase } from '../lib/supabase';
import { colors, fontFamily, fontSize, photoBlocks, radii, spacing } from '../theme/tokens';

type ClipDetail = ClipWithVotes & { places: PlaceWithVotes[]; partySize: number };

function timeAgo(iso: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function StarIcon() {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" fill={colors.muted}>
      <Path d="M6 0l1.4 3.3L11 4.5 8.2 6.9l.7 3.6L6 8.8 3.1 10.5l.7-3.6L1 4.5l3.6-1.2z" />
    </Svg>
  );
}

function PlayIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill={colors.navy}>
      <Path d="M5 2.4v13.2L15 9z" />
    </Svg>
  );
}

function BackIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 17 17" fill="none" stroke={colors.navy} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10.4 3.4 5 8.5l5.4 5.1" />
    </Svg>
  );
}

function PlaceRow({
  place,
  index,
  partySize,
  voterLabel,
  onVote,
}: {
  place: PlaceWithVotes;
  index: number;
  partySize: number;
  voterLabel: (voter: Voter) => string;
  onVote: (vote: 'up' | 'down') => void;
}) {
  const subtitle = place.lat != null && place.lng != null
    ? [place.category, place.location_name].filter(Boolean).join(' · ')
    : [place.category ?? 'Place', 'not confirmed'].join(' · ');

  // Same "everyone votes, unanimous wins" bar as the clip-level vote — this
  // is the actual thing that decides whether the place gets a map pin, so
  // each place needs to show its own progress toward that, not just a number.
  const total = Math.max(partySize, place.upCount + place.downCount);
  const segments: Array<'up' | 'no' | 'empty'> = [
    ...Array(place.upCount).fill('up' as const),
    ...Array(place.downCount).fill('no' as const),
  ];
  while (segments.length < total) segments.push('empty');

  return (
    <View style={styles.plc}>
      <View style={styles.plcTop}>
        <View style={[styles.plcSq, { backgroundColor: photoBlocks[index % photoBlocks.length] }]} />
        <View style={styles.plcInfo}>
          <Text style={styles.plcName} numberOfLines={1}>{place.name}</Text>
          <Text style={styles.plcSub} numberOfLines={1}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.plcMeter}>
        <View style={styles.plcBars}>
          {segments.map((s, i) => (
            <View key={i} style={[styles.plcBar, s === 'up' && styles.plcBarUp, s === 'no' && styles.plcBarNo]} />
          ))}
        </View>
        <Text style={styles.plcTally}>
          {place.upCount}/{total}
        </Text>
        <Pressable style={[styles.plcBtn, place.myVote === 'up' && styles.plcBtnOn]} onPress={() => onVote('up')}>
          <UpIcon color={place.myVote === 'up' ? colors.white : colors.muted} />
        </Pressable>
        <Pressable style={[styles.plcBtn, place.myVote === 'down' && styles.plcBtnOff]} onPress={() => onVote('down')}>
          <DownIcon color={colors.muted} />
        </Pressable>
      </View>
      {place.voters.length > 0 && (
        <View style={styles.voters}>
          {place.voters.map((v) => (
            <View key={v.key} style={[styles.voterChip, v.vote === 'down' && styles.voterChipDown]}>
              <Text style={styles.voterText} numberOfLines={1}>
                {v.reaction ?? (v.vote === 'up' ? '↑' : '↓')} {voterLabel(v)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function ClipDetailScreen({ clipId, onBack }: { clipId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [sharer, setSharer] = useState<Profile | null>(null);
  const [voterProfiles, setVoterProfiles] = useState<Record<string, Profile>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const detail = await getClipDetail(clipId);
      setClip(detail);
      const voterIds = detail.places.flatMap((p) => p.voters.map((v) => v.userId)).filter((id): id is string => id != null);
      const empty: Record<string, Profile> = {};
      const [profiles, { data: auth }] = await Promise.all([
        getProfilesByIds([...new Set([detail.shared_by, ...voterIds])]).catch(() => empty),
        supabase.auth.getUser(),
      ]);
      setSharer(profiles[detail.shared_by] ?? null);
      setVoterProfiles(profiles);
      setMyId(auth.user?.id ?? null);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [clipId]);

  useEffect(() => {
    setIsLoading(true);
    fetchAll().finally(() => setIsLoading(false));
  }, [fetchAll]);

  // Two separate subscriptions since clip_place_votes rows aren't tagged
  // with a clip_id directly (only place_id) -- filtering that table on the
  // server side would need every place id known up front, so it's simplest
  // to just refetch on any place-vote change and let the single fetch above
  // rebuild the whole detail view.
  useEffect(() => {
    const channelName = `clip-detail-${clipId}`;
    // Dev-mode Fast Refresh can leave a channel with this same name still
    // subscribed from a previous run of this effect -- adding a listener
    // to an already-subscribed channel throws, so clear any leftover first.
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_clip_votes', filter: `clip_id=eq.${clipId}` },
        () => fetchAll()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clip_place_votes' }, () => fetchAll())
      // Tapbacks on this clip's link in the trip's linked group chat.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_reactions', filter: `clip_id=eq.${clipId}` },
        () => fetchAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clipId, fetchAll]);

  async function handlePlay() {
    if (!clip) return;
    const supported = await Linking.canOpenURL(clip.url);
    if (!supported) {
      Alert.alert("Can't open this link", clip.url);
      return;
    }
    Linking.openURL(clip.url);
  }

  async function handleClipVote(vote: 'up' | 'down') {
    if (!clip) return;
    try {
      await setVote(clip.id, vote, clip.myVote);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function handlePlaceVote(place: PlaceWithVotes, vote: 'up' | 'down') {
    try {
      await setPlaceVote(place.id, vote, place.myVote);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  // Your own vote reads "You"; anyone with a Blendit account shows their
  // name; chat-only friends show the number (or email) they texted from.
  function voterLabel(voter: Voter): string {
    if (voter.userId && voter.userId === myId) return 'You';
    const name = voter.userId ? voterProfiles[voter.userId]?.full_name : null;
    if (name) return name;
    if (voter.handle && voter.handle !== 'me') return formatHandle(voter.handle);
    return 'Someone';
  }

  if (isLoading || !clip) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.centered}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.navy} />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        {clip.thumbnail_url ? (
          <Image source={{ uri: clip.thumbnail_url }} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: photoBlocks[0] }]} />
        )}

        <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={onBack} hitSlop={8}>
          <BackIcon />
        </Pressable>

        <Pressable style={styles.playBtn} onPress={handlePlay} hitSlop={8}>
          <PlayIcon />
        </Pressable>

        <View style={styles.cr}>
          <View style={styles.crAvatar} />
          <View>
            <Text style={styles.crName}>{sharer?.full_name ?? 'Someone'} shared this</Text>
            {clip.author ? (
              <Text style={styles.crMeta}>from @{clip.author} · {timeAgo(clip.created_at)}</Text>
            ) : (
              <Text style={styles.crMeta}>{timeAgo(clip.created_at)} ago</Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, clip.places.length > 1 && styles.bodyNoFooter]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {clip.status !== 'done' ? (
          <View style={styles.sum}>
            <View style={styles.sumH}>
              <StarIcon />
              <Text style={styles.sumHText}>Status</Text>
            </View>
            <Text style={styles.sumP}>
              {clip.status === 'error'
                ? clip.error_message ?? "Couldn't process this clip."
                : 'Still processing — check back in a bit.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.sum}>
              <View style={styles.sumH}>
                <StarIcon />
                <Text style={styles.sumHText}>What this clip says</Text>
              </View>
              <Text style={styles.sumP}>{clip.summary}</Text>
            </View>

            {clip.places.length > 0 && (
              <>
                <Text style={styles.label}>Places we found</Text>
                {clip.places.map((place, i) => (
                  <PlaceRow
                    key={place.id}
                    place={place}
                    index={i}
                    partySize={clip.partySize}
                    voterLabel={voterLabel}
                    onVote={(vote) => handlePlaceVote(place, vote)}
                  />
                ))}
                <Text style={styles.hint}>
                  Vote on each spot — once everyone in the group wants it, it lands on the trip map.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      {clip.places.length <= 1 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.wantBtn, clip.myVote === 'up' && styles.wantBtnOn]}
            onPress={() => handleClipVote('up')}
          >
            <UpIcon color={clip.myVote === 'up' ? colors.white : colors.navy} />
            <Text style={[styles.wantBtnText, clip.myVote === 'up' && styles.wantBtnTextOn]}>Want this</Text>
          </Pressable>
          <Pressable
            style={[styles.notBtn, clip.myVote === 'down' && styles.notBtnOn]}
            onPress={() => handleClipVote('down')}
          >
            <DownIcon color={clip.myVote === 'down' ? colors.white : colors.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  hero: {
    height: 250,
  },
  backBtn: {
    position: 'absolute',
    left: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -25,
    marginTop: -25,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cr: {
    position: 'absolute',
    left: 14,
    bottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  crAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.white,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  crName: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.white,
  },
  crMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.white,
    opacity: 0.88,
    marginTop: 1,
  },
  body: {
    padding: spacing.xxl,
    paddingBottom: 110,
  },
  bodyNoFooter: {
    paddingBottom: spacing.xxl,
  },
  sum: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    padding: 13,
    marginBottom: spacing.xxl,
  },
  sumH: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sumHText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  sumP: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: 20,
    color: colors.text,
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  plc: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: 10,
    marginBottom: spacing.sm,
  },
  plcTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  plcSq: {
    width: 38,
    height: 38,
    borderRadius: 7,
  },
  plcInfo: {
    flex: 1,
  },
  plcName: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  plcSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  plcMeter: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  plcBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
  },
  plcBar: {
    height: 5,
    flex: 1,
    borderRadius: 1,
    backgroundColor: colors.line,
  },
  plcBarUp: {
    backgroundColor: colors.blue,
  },
  plcBarNo: {
    backgroundColor: colors.line,
    borderWidth: 1,
    borderColor: colors.chip,
  },
  voters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  voterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: colors.lineSoft,
    maxWidth: '100%',
  },
  voterChipDown: {
    opacity: 0.6,
  },
  voterText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  plcTally: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.navy,
  },
  plcBtn: {
    width: 29,
    height: 29,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plcBtnOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  plcBtnOff: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
  },
  hint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  wantBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingVertical: spacing.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  wantBtnOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  wantBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.base,
    color: colors.navy,
  },
  wantBtnTextOn: {
    color: colors.white,
  },
  notBtn: {
    width: 60,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  notBtnOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
});
