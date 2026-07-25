import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { Avatar, Button, Chip, TextField } from '../components/ui';
import { addClip, ClipSource, ClipWithVotes, listClipsWithVotes, setVote } from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { getProfilesByIds, Profile } from '../lib/profile';
import { getTripWithMembers, Trip, tripDisplayName } from '../lib/trips';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

type Tab = 'blend' | 'itinerary';

function timeAgo(iso: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function UpIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 11.5V2.8M3.4 6.4 7 2.8l3.6 3.6" />
    </Svg>
  );
}

function DownIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 2.5v8.7M3.4 7.6 7 11.2l3.6-3.6" />
    </Svg>
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

export function TripViewScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('blend');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [clips, setClips] = useState<ClipWithVotes[]>([]);
  const [sharerProfiles, setSharerProfiles] = useState<Record<string, Profile>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [source, setSource] = useState<ClipSource>('TikTok');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [{ trip: t }, clipsData] = await Promise.all([
        getTripWithMembers(tripId),
        listClipsWithVotes(tripId),
      ]);
      setTrip(t);
      setClips(clipsData);
      // Best-effort enrichment — a hiccup here shouldn't block the clips.
      const empty: Record<string, Profile> = {};
      setSharerProfiles(await getProfilesByIds(clipsData.map((clip) => clip.shared_by)).catch(() => empty));
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [tripId]);

  useEffect(() => {
    setIsLoading(true);
    fetchAll().finally(() => setIsLoading(false));
  }, [fetchAll]);

  async function handleOpenClip(url: string) {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Can't open this link", url);
      return;
    }
    Linking.openURL(url);
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

  async function handleShare() {
    if (!url.trim() || !title.trim()) return;
    setIsSubmitting(true);
    try {
      await addClip(tripId, { source, url, title, description });
      setUrl('');
      setTitle('');
      setDescription('');
      setIsAdding(false);
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  const itineraryClips = useMemo(
    () => clips.filter((c) => c.upCount > c.downCount && c.upCount > 0).sort((a, b) => b.upCount - a.upCount),
    [clips]
  );

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

      <View style={styles.seg}>
        <Pressable style={styles.segBtn} onPress={() => setTab('blend')}>
          <Text style={[styles.segText, tab === 'blend' && styles.segTextOn]}>Blend</Text>
          {tab === 'blend' && <View style={styles.segUnderline} />}
        </Pressable>
        <Pressable style={styles.segBtn} onPress={() => setTab('itinerary')}>
          <Text style={[styles.segText, tab === 'itinerary' && styles.segTextOn]}>Itinerary</Text>
          {tab === 'itinerary' && <View style={styles.segUnderline} />}
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : (
        <DismissKeyboardView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {tab === 'blend' ? (
            <>
              {isAdding ? (
                <View style={styles.addCard}>
                  <View style={styles.sourceRow}>
                    <Chip label="TikTok" variant={source === 'TikTok' ? 'on' : 'out'} onPress={() => setSource('TikTok')} />
                    <Chip
                      label="Instagram Reels"
                      variant={source === 'Instagram Reels' ? 'on' : 'out'}
                      onPress={() => setSource('Instagram Reels')}
                    />
                  </View>
                  <TextField label="Link" value={url} onChangeText={setUrl} placeholder="https://tiktok.com/…" autoCapitalize="none" />
                  <TextField label="What's it of" value={title} onChangeText={setTitle} placeholder="Golden Gai bar crawl" />
                  <TextField
                    label="Notes"
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Go after 9pm, skip the ones with a cover…"
                    multiline
                    numberOfLines={3}
                    style={styles.textarea}
                  />
                  <View style={styles.addCardActions}>
                    <View style={styles.addCardActionFlex}>
                      <Button title="Cancel" variant="secondary" onPress={() => setIsAdding(false)} />
                    </View>
                    <View style={styles.addCardActionFlex}>
                      <Button
                        title="Share to trip"
                        onPress={handleShare}
                        loading={isSubmitting}
                        disabled={!url.trim() || !title.trim()}
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
                    <Pressable onPress={() => handleOpenClip(clip.url)}>
                      <View style={styles.clipTop}>
                        <Avatar uri={sharerProfiles[clip.shared_by]?.avatar_url ?? null} size={24} />
                        <Text style={styles.clipSharerName}>
                          {sharerProfiles[clip.shared_by]?.full_name ?? 'Someone'}
                        </Text>
                        <Text style={styles.clipTime}>{timeAgo(clip.created_at)}</Text>
                        <Text style={styles.clipSource}>{clip.source}</Text>
                      </View>
                      <Text style={styles.clipTitle}>{clip.title}</Text>
                      {clip.description ? <Text style={styles.clipBody}>{clip.description}</Text> : null}
                    </Pressable>
                    <ConsensusMeter
                      clip={clip}
                      partySize={trip?.party_size ?? 1}
                      onVote={(vote) => handleVote(clip.id, vote)}
                    />
                  </View>
                ))
              )}
            </>
          ) : itineraryClips.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing's cleared the vote yet</Text>
              <Text style={styles.emptyBody}>Once a clip has more up-votes than down, it lands here.</Text>
            </View>
          ) : (
            itineraryClips.map((clip) => (
              <View key={clip.id} style={styles.stopCard}>
                <View style={styles.stopSquare} />
                <View style={styles.stopInfo}>
                  <Text style={styles.stopTitle}>{clip.title}</Text>
                  <Text style={styles.stopMeta}>{clip.source}</Text>
                </View>
                <Text style={styles.stopBadge}>
                  {clip.upCount}/{Math.max(trip?.party_size ?? 1, clip.upCount + clip.downCount)}
                </Text>
              </View>
            ))
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
  seg: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 11,
  },
  segText: {
    fontFamily: fontFamily.semibold,
    fontSize: 14.5,
    color: colors.mutedSoft,
  },
  segTextOn: {
    color: colors.navy,
  },
  segUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.navy,
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
  sourceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  textarea: {
    minHeight: 72,
    textAlignVertical: 'top',
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
  meter: {
    marginTop: spacing.lg,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
    backgroundColor: '#8CA8CB',
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
