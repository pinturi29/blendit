import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { Avatar, Button, Chip, Wordmark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { listPendingVotesByTrip, PendingVoteSummary } from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { getAvatarUrl, getProfilesByIds, Profile } from '../lib/profile';
import {
  acceptInvite,
  formatDateRange,
  listMyTrips,
  listPendingInvites,
  nightsBetween,
  removeInvite,
  Trip,
  tripDisplayName,
  TripInvite,
} from '../lib/trips';
import { colors, fontFamily, fontSize, photoBlocks, radii, spacing } from '../theme/tokens';

type Filter = 'all' | 'planning' | 'archived' | 'invites';

function TripRow({ trip, index, onPress }: { trip: Trip; index: number; onPress: () => void }) {
  const nights = nightsBetween(trip.start_date, trip.end_date);
  return (
    <Pressable style={styles.tripRow} onPress={onPress}>
      {trip.cover_photo_url ? (
        <Image source={{ uri: trip.cover_photo_url }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: photoBlocks[index % photoBlocks.length] }]} />
      )}
      <View style={styles.tripInfo}>
        <Text style={styles.tripName}>{tripDisplayName(trip)}</Text>
        <Text style={styles.tripMeta}>
          {formatDateRange(trip.start_date, trip.end_date)} · {nights} night{nights === 1 ? '' : 's'} ·{' '}
          {trip.party_size} going
        </Text>
      </View>
    </Pressable>
  );
}

function InviteRow({
  invite,
  trip,
  index,
  inviter,
  onChanged,
}: {
  invite: TripInvite;
  trip: Trip;
  index: number;
  inviter: Profile | undefined;
  onChanged: () => void;
}) {
  const [isBusy, setIsBusy] = useState<'accept' | 'reject' | null>(null);

  async function handleAccept() {
    setIsBusy('accept');
    try {
      await acceptInvite(invite.id);
      onChanged();
    } finally {
      setIsBusy(null);
    }
  }

  async function handleReject() {
    setIsBusy('reject');
    try {
      await removeInvite(invite.id);
      onChanged();
    } finally {
      setIsBusy(null);
    }
  }

  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteRowTop}>
        {trip.cover_photo_url ? (
          <Image source={{ uri: trip.cover_photo_url }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, { backgroundColor: photoBlocks[index % photoBlocks.length] }]} />
        )}
        <View style={styles.tripInfo}>
          <Text style={styles.tripName}>{tripDisplayName(trip)}</Text>
          <Text style={styles.tripMeta}>{formatDateRange(trip.start_date, trip.end_date)}</Text>
        </View>
      </View>
      {inviter && (
        <View style={styles.invitedByRow}>
          <Avatar uri={inviter.avatar_url} size={18} />
          <Text style={styles.invitedByText}>Invited by {inviter.full_name ?? inviter.email}</Text>
        </View>
      )}
      <View style={styles.inviteActions}>
        <View style={styles.inviteActionFlex}>
          <Button title="Accept" onPress={handleAccept} loading={isBusy === 'accept'} disabled={isBusy !== null} />
        </View>
        <View style={styles.inviteActionFlex}>
          <Button
            title="Reject"
            variant="secondary"
            onPress={handleReject}
            loading={isBusy === 'reject'}
            disabled={isBusy !== null}
          />
        </View>
      </View>
    </View>
  );
}

function FeaturedTripCard({ trip, index, onPress }: { trip: Trip; index: number; onPress: () => void }) {
  return (
    <Pressable style={styles.fc} onPress={onPress}>
      {trip.cover_photo_url ? (
        <Image source={{ uri: trip.cover_photo_url }} style={styles.fcImg} />
      ) : (
        <View style={[styles.fcImg, { backgroundColor: photoBlocks[index % photoBlocks.length] }]} />
      )}
      <View style={styles.fcBody}>
        <Text style={styles.fcName}>{tripDisplayName(trip)}</Text>
        <Text style={styles.fcMeta}>
          {formatDateRange(trip.start_date, trip.end_date)} · {trip.party_size} going
        </Text>
      </View>
    </Pressable>
  );
}

function UnlockCard({ summary, onOpen }: { summary: PendingVoteSummary; onOpen: () => void }) {
  const daysUntil = Math.ceil((new Date(summary.trip.start_date).getTime() - Date.now()) / 86400000);
  const shown = summary.clips.slice(0, 3);
  const shortName = tripDisplayName(summary.trip).split(',')[0];

  return (
    <View style={styles.unlockCard}>
      <Text style={styles.unlockTitle}>
        {summary.clips.length} clip{summary.clips.length === 1 ? '' : 's'} waiting on your vote
      </Text>
      <Text style={styles.unlockSub}>
        {shortName} {daysUntil <= 0 ? 'has already started' : `starts in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}
      </Text>
      <View style={styles.unlockIcons}>
        {shown.map((clip, i) => (
          <View key={clip.id} style={styles.unlockIcon}>
            <View style={[styles.unlockBox, { backgroundColor: photoBlocks[i % photoBlocks.length] }]} />
            <Text style={styles.unlockIconLabel} numberOfLines={2}>
              {clip.title}
            </Text>
          </View>
        ))}
        <Pressable style={styles.unlockIcon} onPress={onOpen}>
          <View style={[styles.unlockBox, styles.unlockBoxMuted]}>
            <Text style={styles.unlockPlus}>+</Text>
          </View>
          <Text style={styles.unlockIconLabel}>See all</Text>
        </Pressable>
      </View>
      <Button title={`Open ${shortName} blend`} onPress={onOpen} />
    </View>
  );
}

export function HomeScreen({
  onOpenProfile,
  onOpenTrip,
  onOpenBlend,
}: {
  onOpenProfile: () => void;
  onOpenTrip: (tripId: string) => void;
  onOpenBlend: (tripId: string) => void;
}) {
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [invites, setInvites] = useState<Array<{ invite: TripInvite; trip: Trip }>>([]);
  const [inviterProfiles, setInviterProfiles] = useState<Record<string, Profile>>({});
  const [pendingVotes, setPendingVotes] = useState<PendingVoteSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [tripsData, invitesData, votesData] = await Promise.all([
        listMyTrips(),
        listPendingInvites(),
        listPendingVotesByTrip(),
      ]);
      setTrips(tripsData);
      setInvites(invitesData);
      setPendingVotes(votesData);
      // Best-effort enrichment — a hiccup here shouldn't block the trip list.
      const empty: Record<string, Profile> = {};
      setInviterProfiles(
        await getProfilesByIds(invitesData.map((row) => row.invite.invited_by)).catch(() => empty)
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchAll().finally(() => setIsLoading(false));
  }, [fetchAll]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchAll();
    setIsRefreshing(false);
  }

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const planningTrips = useMemo(() => trips.filter((t) => t.end_date >= today), [trips, today]);
  const filteredTrips = useMemo(() => {
    if (filter === 'planning') return planningTrips;
    if (filter === 'archived') return trips.filter((t) => t.end_date < today);
    return trips;
  }, [trips, planningTrips, filter, today]);

  const topPendingVotes = useMemo(
    () => [...pendingVotes].sort((a, b) => b.clips.length - a.clips.length)[0] ?? null,
    [pendingVotes]
  );

  const showingInvites = filter === 'invites';
  const showTopSections = filter === 'all';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Wordmark />
        <Pressable onPress={onOpenProfile} hitSlop={8}>
          <Avatar uri={session ? getAvatarUrl(session.user) : null} size={38} />
        </Pressable>
      </View>

      <View style={styles.chips}>
        <Chip label="All trips" variant={filter === 'all' ? 'on' : 'out'} onPress={() => setFilter('all')} />
        <Chip
          label="Archived"
          variant={filter === 'archived' ? 'on' : 'out'}
          onPress={() => setFilter('archived')}
        />
        <Chip
          label={`Invites${invites.length > 0 ? ` (${invites.length})` : ''}`}
          variant={filter === 'invites' ? 'on' : 'out'}
          onPress={() => setFilter('invites')}
        />
      </View>

      {showingInvites ? (
        <FlatList
          data={invites}
          keyExtractor={(row) => row.invite.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          renderItem={({ item, index }) => (
            <InviteRow
              invite={item.invite}
              trip={item.trip}
              index={index}
              inviter={inviterProfiles[item.invite.invited_by]}
              onChanged={fetchAll}
            />
          )}
          ListEmptyComponent={
            isLoading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No pending invites</Text>
                <Text style={styles.emptyBody}>Trips people invite you to will show up here.</Text>
              </View>
            )
          }
        />
      ) : (
        <DismissKeyboardView style={styles.flex}>
          <FlatList
            data={filteredTrips}
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
            renderItem={({ item, index }) => (
              <TripRow trip={item} index={index} onPress={() => onOpenTrip(item.id)} />
            )}
            ListHeaderComponent={
              showTopSections ? (
                <View>
                  {topPendingVotes && (
                    <UnlockCard summary={topPendingVotes} onOpen={() => onOpenBlend(topPendingVotes.trip.id)} />
                  )}

                  {planningTrips.length > 0 && (
                    <>
                      <View style={styles.rowhead}>
                        <Text style={styles.rowheadLabel}>Planning now</Text>
                        <Pressable onPress={() => setFilter('planning')}>
                          <Text style={styles.rowheadSee}>See all</Text>
                        </Pressable>
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.rail}
                      >
                        {planningTrips.map((trip, i) => (
                          <FeaturedTripCard key={trip.id} trip={trip} index={i} onPress={() => onOpenTrip(trip.id)} />
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text style={styles.sectionLabelMut}>All trips</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              isLoading ? null : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>{error ? 'Something went wrong' : 'No trips yet'}</Text>
                  <Text style={styles.emptyBody}>{error ?? 'Tap the + button to plan your first trip.'}</Text>
                </View>
              )
            }
          />
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
    paddingBottom: spacing.xl,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  listContent: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: 140,
    flexGrow: 1,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: radii.md,
  },
  tripInfo: {
    flex: 1,
  },
  tripName: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    color: colors.text,
  },
  tripMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.smd,
    color: colors.muted,
    marginTop: 3,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
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
  inviteCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 13,
    marginBottom: spacing.lg,
  },
  inviteRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  invitedByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  invitedByText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inviteActionFlex: {
    flex: 1,
  },
  unlockCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 15,
    marginBottom: spacing.lg,
  },
  unlockTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17.5,
    color: colors.navy,
  },
  unlockSub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: colors.mutedSoft,
    marginTop: 3,
  },
  unlockIcons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginVertical: spacing.xl,
  },
  unlockIcon: {
    width: 68,
    alignItems: 'center',
  },
  unlockBox: {
    width: 68,
    height: 66,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockBoxMuted: {
    backgroundColor: colors.fill,
  },
  unlockPlus: {
    fontFamily: fontFamily.regular,
    fontSize: 22,
    color: colors.muted,
  },
  unlockIconLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.xs,
    lineHeight: 14,
    color: colors.text,
    textAlign: 'center',
  },
  rowhead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  rowheadLabel: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text,
  },
  rowheadSee: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.blue,
  },
  rail: {
    gap: 11,
    paddingBottom: spacing.xxxl,
  },
  fc: {
    width: 210,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  fcImg: {
    height: 118,
  },
  fcBody: {
    padding: 12,
  },
  fcName: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.base,
    color: colors.text,
  },
  fcMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  sectionLabelMut: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: spacing.md,
  },
});
