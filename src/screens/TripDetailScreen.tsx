import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DateField } from '../components/DateField';
import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { PlaceField } from '../components/PlaceField';
import { Avatar, Button, Card, EditBadge, TextField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../lib/errors';
import { getAvatarUrl, getProfilesByEmails, getProfilesByIds, Profile } from '../lib/profile';
import { pickAndUploadTripCoverPhoto } from '../lib/tripCover';
import {
  addTripStop,
  deleteTrip,
  formatDateRange,
  getTripWithMembers,
  listTripStops,
  nightsBetween,
  removeInvite,
  removeTripStop,
  Trip,
  tripDisplayName,
  TripInvite,
  TripStop,
  updateHomeBase,
  updateTripDates,
  updateTripName,
} from '../lib/trips';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromISODate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

export function TripDetailScreen({
  tripId,
  onBack,
  onDeleted,
  onViewTrip,
}: {
  tripId: string;
  onBack: () => void;
  onDeleted: () => void;
  onViewTrip: () => void;
}) {
  const { session } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripInvite[]>([]);
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, Profile>>({});
  const [stops, setStops] = useState<TripStop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [stopInput, setStopInput] = useState('');
  const [stopCoords, setStopCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [isAddingStop, setIsAddingStop] = useState(false);
  const [removingStopId, setRemovingStopId] = useState<string | null>(null);

  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isEditingTripName, setIsEditingTripName] = useState(false);
  const [tripNameDraft, setTripNameDraft] = useState('');
  const [isSavingTripName, setIsSavingTripName] = useState(false);

  const [isEditingHomeBase, setIsEditingHomeBase] = useState(false);
  const [homeBaseDraft, setHomeBaseDraft] = useState('');
  const [homeBaseCoordsDraft, setHomeBaseCoordsDraft] = useState<{ lat: number; lon: number } | null>(null);
  const [isSavingHomeBase, setIsSavingHomeBase] = useState(false);

  const [isEditingDates, setIsEditingDates] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState(() => new Date());
  const [endDateDraft, setEndDateDraft] = useState(() => new Date());
  const [isSavingDates, setIsSavingDates] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);

  const fetchTrip = useCallback(async () => {
    try {
      setError(null);
      const [{ trip: t, members: m }, s] = await Promise.all([
        getTripWithMembers(tripId),
        listTripStops(tripId),
      ]);
      setTrip(t);
      setMembers(m);
      setStops(s);
      // Best-effort enrichment — a hiccup here (e.g. profiles not set up
      // yet) shouldn't block the trip itself from rendering.
      const emptyProfiles: Record<string, Profile> = {};
      const [ownerProfiles, memberProfilesByEmail] = await Promise.all([
        getProfilesByIds([t.owner_id]).catch(() => emptyProfiles),
        getProfilesByEmails(m.map((mm) => mm.email)).catch(() => emptyProfiles),
      ]);
      setOwnerProfile(ownerProfiles[t.owner_id] ?? null);
      setMemberProfiles(memberProfilesByEmail);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [tripId]);

  useEffect(() => {
    setIsLoading(true);
    fetchTrip().finally(() => setIsLoading(false));
  }, [fetchTrip]);

  const isOwner = trip?.owner_id === session?.user.id;

  async function handleAddStop() {
    if (!stopInput.trim()) return;
    setIsAddingStop(true);
    try {
      const stop = await addTripStop(tripId, {
        label: stopInput.trim(),
        lat: stopCoords?.lat ?? null,
        lng: stopCoords?.lon ?? null,
      });
      setStops((prev) => [...prev, stop]);
      setStopInput('');
      setStopCoords(null);
    } catch (e) {
      Alert.alert('Could not add location', getErrorMessage(e));
    } finally {
      setIsAddingStop(false);
    }
  }

  async function handleRemoveStop(stopId: string) {
    setRemovingStopId(stopId);
    try {
      await removeTripStop(stopId);
      setStops((prev) => prev.filter((s) => s.id !== stopId));
    } catch (e) {
      Alert.alert('Could not remove location', getErrorMessage(e));
    } finally {
      setRemovingStopId(null);
    }
  }

  async function handleRemove(inviteId: string) {
    setRemovingId(inviteId);
    try {
      await removeInvite(inviteId);
      await fetchTrip();
    } catch (e) {
      Alert.alert('Could not remove', getErrorMessage(e));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDelete() {
    if (!trip) return;
    setIsDeleting(true);
    try {
      await deleteTrip(trip.id);
      onDeleted();
    } catch (e) {
      setIsDeleting(false);
      Alert.alert('Could not delete trip', getErrorMessage(e));
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this trip?', "This removes it for everyone you invited. This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete trip', style: 'destructive', onPress: handleDelete },
    ]);
  }

  async function handleChangeCover() {
    setIsUploadingCover(true);
    try {
      const url = await pickAndUploadTripCoverPhoto(tripId);
      if (url) setTrip((prev) => (prev ? { ...prev, cover_photo_url: url } : prev));
    } catch (e) {
      Alert.alert('Could not update cover photo', getErrorMessage(e));
    } finally {
      setIsUploadingCover(false);
    }
  }

  function openEditTripName() {
    setTripNameDraft(trip?.name ?? '');
    setIsEditingTripName(true);
  }

  async function handleSaveTripName() {
    if (!trip) return;
    setIsSavingTripName(true);
    try {
      await updateTripName(trip.id, tripNameDraft);
      setTrip((prev) => (prev ? { ...prev, name: tripNameDraft.trim() || null } : prev));
      setIsEditingTripName(false);
    } catch (e) {
      Alert.alert('Could not update trip name', getErrorMessage(e));
    } finally {
      setIsSavingTripName(false);
    }
  }

  function openEditHomeBase() {
    setHomeBaseDraft(trip?.home_base_label ?? '');
    setHomeBaseCoordsDraft(
      trip?.home_base_lat != null && trip?.home_base_lng != null
        ? { lat: trip.home_base_lat, lon: trip.home_base_lng }
        : null
    );
    setIsEditingHomeBase(true);
  }

  async function handleSaveHomeBase() {
    if (!trip) return;
    setIsSavingHomeBase(true);
    try {
      const place = homeBaseDraft.trim()
        ? { label: homeBaseDraft, lat: homeBaseCoordsDraft?.lat ?? null, lng: homeBaseCoordsDraft?.lon ?? null }
        : null;
      await updateHomeBase(trip.id, place);
      setTrip((prev) =>
        prev
          ? {
              ...prev,
              home_base_label: place?.label.trim() || null,
              home_base_lat: place?.lat ?? null,
              home_base_lng: place?.lng ?? null,
            }
          : prev
      );
      setIsEditingHomeBase(false);
    } catch (e) {
      Alert.alert('Could not update home base', getErrorMessage(e));
    } finally {
      setIsSavingHomeBase(false);
    }
  }

  function openEditDates() {
    if (!trip) return;
    setStartDateDraft(fromISODate(trip.start_date));
    setEndDateDraft(fromISODate(trip.end_date));
    setDatesError(null);
    setIsEditingDates(true);
  }

  async function handleSaveDates() {
    if (!trip) return;
    if (endDateDraft < startDateDraft) {
      setDatesError('Return date is before the leave date.');
      return;
    }
    setDatesError(null);
    setIsSavingDates(true);
    try {
      const startDate = toISODate(startDateDraft);
      const endDate = toISODate(endDateDraft);
      await updateTripDates(trip.id, startDate, endDate);
      setTrip((prev) => (prev ? { ...prev, start_date: startDate, end_date: endDate } : prev));
      setIsEditingDates(false);
    } catch (e) {
      Alert.alert('Could not update dates', getErrorMessage(e));
    } finally {
      setIsSavingDates(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {trip ? tripDisplayName(trip) : ''}
        </Text>
        <Pressable onPress={openEditTripName} hitSlop={8}>
          <Text style={styles.changeName}>Change name</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : error || !trip ? (
        <View style={styles.centered}>
          <Text style={styles.emptyBody}>{error ?? 'Trip not found.'}</Text>
        </View>
      ) : (
        <>
          <DismissKeyboardView style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Pressable onPress={handleChangeCover} disabled={isUploadingCover || !isOwner}>
              <View style={styles.cover}>
                {trip.cover_photo_url ? (
                  <Image source={{ uri: trip.cover_photo_url }} style={styles.coverImage} />
                ) : (
                  <View style={styles.coverPlaceholder} />
                )}
                {isUploadingCover && (
                  <View style={styles.coverLoading}>
                    <ActivityIndicator color={colors.white} />
                  </View>
                )}
                {isOwner && (
                  <View style={styles.coverBadge}>
                    <EditBadge />
                  </View>
                )}
              </View>
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.tripName}>{tripDisplayName(trip)}</Text>
              {trip.name?.trim() ? <Text style={styles.tripDestinationSub}>{trip.destination}</Text> : null}
            </View>

            <Card>
              <View style={styles.tripDatesRow}>
                <Text style={styles.tripDates}>{formatDateRange(trip.start_date, trip.end_date)}</Text>
                <Pressable onPress={openEditDates} hitSlop={8}>
                  <Text style={styles.changeName}>Edit</Text>
                </Pressable>
              </View>
              <Text style={styles.tripMeta}>
                {nightsBetween(trip.start_date, trip.end_date)} nights · {trip.party_size} going
              </Text>
              {trip.description ? <Text style={styles.description}>{trip.description}</Text> : null}
            </Card>

            <View style={styles.viewTripRow}>
              <Button title="View trip" onPress={onViewTrip} />
            </View>

            <View style={styles.sectionLabelRow}>
              <Text style={[styles.sectionLabel, styles.sectionLabelNoMargin]}>Home base</Text>
              {isOwner && (
                <Pressable onPress={openEditHomeBase} hitSlop={8}>
                  <Text style={styles.changeName}>{trip.home_base_label ? 'Change' : 'Add'}</Text>
                </Pressable>
              )}
            </View>
            {trip.home_base_label ? (
              <View style={styles.memberRow}>
                <View style={[styles.stopDot, styles.homeBaseDot]} />
                <Text style={styles.memberEmail} numberOfLines={1}>
                  {trip.home_base_label}
                </Text>
              </View>
            ) : (
              <Text style={styles.emptyBodyLeft}>Not set yet — where's the group staying?</Text>
            )}

            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Stops</Text>
            {stops.map((stop) => (
              <View key={stop.id} style={styles.memberRow}>
                <View style={styles.stopDot} />
                <Text style={styles.memberEmail} numberOfLines={1}>
                  {stop.label}
                </Text>
                <Pressable
                  onPress={() => handleRemoveStop(stop.id)}
                  disabled={removingStopId === stop.id}
                  hitSlop={8}
                >
                  <Text style={styles.remove}>{removingStopId === stop.id ? '…' : 'Remove'}</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addStopRow}>
              <View style={styles.addStopField}>
                <PlaceField
                  label="Add a location"
                  value={stopInput}
                  onChangeText={(text) => {
                    setStopInput(text);
                    setStopCoords(null);
                  }}
                  onSelect={(place) => {
                    setStopInput(place.label);
                    setStopCoords({ lat: place.lat, lon: place.lon });
                  }}
                  placeholder="Golden Gai, Shinjuku"
                />
              </View>
            </View>
            <Button
              title="Add location"
              variant="secondary"
              onPress={handleAddStop}
              loading={isAddingStop}
              disabled={!stopInput.trim()}
            />

            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Who's going</Text>
            <View style={styles.memberRow}>
              <Avatar
                uri={isOwner ? (session ? getAvatarUrl(session.user) : null) : ownerProfile?.avatar_url ?? null}
                size={28}
              />
              <Text style={styles.memberEmail}>
                {isOwner ? 'You' : ownerProfile?.full_name ?? ownerProfile?.email ?? 'Trip owner'}
              </Text>
              <Text style={styles.memberStatus}>Owner</Text>
            </View>
            {members.map((m) => {
              const profile = memberProfiles[m.email];
              return (
                <View key={m.id} style={styles.memberRow}>
                  <Avatar uri={profile?.avatar_url ?? null} size={28} />
                  <Text style={styles.memberEmail} numberOfLines={1}>
                    {profile?.full_name ?? m.email}
                  </Text>
                  <Text style={styles.memberStatus}>{m.status === 'joined' ? 'Joined' : 'Invited'}</Text>
                  {isOwner && (
                    <Pressable onPress={() => handleRemove(m.id)} disabled={removingId === m.id} hitSlop={8}>
                      <Text style={styles.remove}>{removingId === m.id ? '…' : 'Remove'}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
          </DismissKeyboardView>

          {isOwner && (
            <View style={styles.footer}>
              <Button title="Delete trip" variant="secondary" onPress={confirmDelete} loading={isDeleting} />
            </View>
          )}
        </>
      )}

      <Modal
        visible={isEditingTripName}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditingTripName(false)}
      >
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.overlay} onPress={() => setIsEditingTripName(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <TextField
                label="Trip name"
                value={tripNameDraft}
                onChangeText={setTripNameDraft}
                placeholder={trip?.destination}
                autoFocus
              />
              <Button title="Save" onPress={handleSaveTripName} loading={isSavingTripName} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isEditingHomeBase}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditingHomeBase(false)}
      >
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.overlay} onPress={() => setIsEditingHomeBase(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <PlaceField
                label="Home base"
                value={homeBaseDraft}
                onChangeText={(text) => {
                  setHomeBaseDraft(text);
                  setHomeBaseCoordsDraft(null);
                }}
                onSelect={(place) => {
                  setHomeBaseDraft(place.label);
                  setHomeBaseCoordsDraft({ lat: place.lat, lon: place.lon });
                }}
                placeholder="Hotel or Airbnb address"
              />
              <Button title="Save" onPress={handleSaveHomeBase} loading={isSavingHomeBase} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isEditingDates}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditingDates(false)}
      >
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.overlay} onPress={() => setIsEditingDates(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.datePair}>
                <View style={styles.datePairItem}>
                  <DateField label="Leaving" value={startDateDraft} onChange={setStartDateDraft} />
                </View>
                <View style={styles.datePairItem}>
                  <DateField
                    label="Coming back"
                    value={endDateDraft}
                    onChange={setEndDateDraft}
                    minimumDate={startDateDraft}
                  />
                </View>
              </View>
              {datesError ? <Text style={styles.error}>{datesError}</Text> : null}
              <Button title="Save" onPress={handleSaveDates} loading={isSavingDates} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
  changeName: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.blue,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    textAlign: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  cover: {
    width: '100%',
    height: 180,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.fill,
    marginBottom: spacing.xl,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#DAE2ED',
  },
  coverLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,40,66,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
  },
  titleBlock: {
    marginBottom: spacing.xl,
  },
  tripName: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.heading,
    color: colors.text,
  },
  tripDestinationSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: 3,
  },
  tripDatesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripDates: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.navy,
  },
  tripMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  description: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 20,
    marginTop: spacing.lg,
  },
  viewTripRow: {
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  sectionLabelSpaced: {
    marginTop: spacing.xxxl,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sectionLabelNoMargin: {
    marginBottom: 0,
  },
  emptyBodyLeft: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
  },
  addStopRow: {
    flexDirection: 'row',
  },
  addStopField: {
    flex: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  stopDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#A9BFDA',
  },
  homeBaseDot: {
    backgroundColor: '#8B1E1E',
  },
  memberEmail: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.text,
  },
  memberStatus: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  remove: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginLeft: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(12,40,66,0.36)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xxl,
  },
  datePair: {
    flexDirection: 'row',
    gap: 10,
  },
  datePairItem: {
    flex: 1,
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
});
