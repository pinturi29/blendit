import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, EditBadge, TextField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { countMySharedClips, countMySharedReels } from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { getAvatarUrl, getDisplayName, pickAndUploadAvatar, updateDisplayName } from '../lib/profile';
import { listMyTrips, Trip } from '../lib/trips';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const { session, signOut } = useAuth();
  const user = session?.user ?? null;

  const [trips, setTrips] = useState<Trip[]>([]);
  const [sharedCount, setSharedCount] = useState(0);
  const [reelsCount, setReelsCount] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setStatsError(null);
      const [tripsData, shared, reels] = await Promise.all([
        listMyTrips(),
        countMySharedClips(),
        countMySharedReels(),
      ]);
      setTrips(tripsData);
      setSharedCount(shared);
      setReelsCount(reels);
    } catch (e) {
      setStatsError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    setIsLoadingStats(true);
    fetchStats().finally(() => setIsLoadingStats(false));
  }, [fetchStats]);

  if (!user) return null;

  const today = new Date().toISOString().slice(0, 10);
  const archivedCount = trips.filter((t) => t.end_date < today).length;
  const avatarUrl = getAvatarUrl(user);
  const rawName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';

  async function handleChangeAvatar() {
    setIsUploadingAvatar(true);
    try {
      await pickAndUploadAvatar(user!.id);
    } catch (e) {
      Alert.alert('Could not update photo', getErrorMessage(e));
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  function openEditName() {
    setNameDraft(rawName);
    setIsEditingName(true);
  }

  async function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setIsSavingName(true);
    try {
      await updateDisplayName(trimmed);
      setIsEditingName(false);
    } catch (e) {
      Alert.alert('Could not update name', getErrorMessage(e));
    } finally {
      setIsSavingName(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <Pressable onPress={handleChangeAvatar} disabled={isUploadingAvatar}>
          <View style={styles.avatar}>
            <Avatar uri={avatarUrl} size={82} />
            {isUploadingAvatar && (
              <View style={styles.avatarLoading}>
                <ActivityIndicator color={colors.white} />
              </View>
            )}
            <View style={styles.avatarBadge}>
              <EditBadge />
            </View>
          </View>
        </Pressable>

        <Pressable onPress={openEditName} hitSlop={8}>
          <Text style={styles.name}>{getDisplayName(user)}</Text>
        </Pressable>
        <Text style={styles.email}>{user.email}</Text>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{isLoadingStats ? '…' : trips.length}</Text>
            <Text style={styles.statLabel}>trips</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{isLoadingStats ? '…' : sharedCount}</Text>
            <Text style={styles.statLabel}>shared</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{isLoadingStats ? '…' : archivedCount}</Text>
            <Text style={styles.statLabel}>archived</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{isLoadingStats ? '…' : reelsCount}</Text>
            <Text style={styles.statLabel}>reels</Text>
          </View>
        </View>
        {statsError ? <Text style={styles.error}>{statsError}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Button title="Log out" variant="secondary" onPress={signOut} />
      </View>

      <Modal visible={isEditingName} transparent animationType="fade" onRequestClose={() => setIsEditingName(false)}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.overlay} onPress={() => setIsEditingName(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <TextField
                label="Your name"
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Jordan Vasquez"
                autoFocus
              />
              <Button title="Save" onPress={handleSaveName} loading={isSavingName} disabled={!nameDraft.trim()} />
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
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    color: colors.text,
  },
  headerSpacer: {
    width: 32,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  avatar: {
    width: 82,
    height: 82,
    marginBottom: spacing.lg,
  },
  avatarLoading: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 41,
    backgroundColor: 'rgba(12,40,66,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
    textAlign: 'center',
  },
  email: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 22,
    marginTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    width: '100%',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
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
});
