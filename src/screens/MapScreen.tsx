import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { Avatar, Chip, Wordmark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../lib/errors';
import { buildMapHtml } from '../lib/mapHtml';
import { getAvatarUrl } from '../lib/profile';
import { formatDateRange, listMyTrips, Trip, tripDisplayName } from '../lib/trips';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

export function MapScreen({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const webviewRef = useRef<WebView>(null);

  useEffect(() => {
    listMyTrips()
      .then(setTrips)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setIsLoading(false));
  }, []);

  const mappable = useMemo(() => trips.filter((t) => t.lat != null && t.lng != null), [trips]);
  const html = useMemo(
    () => buildMapHtml(mappable.map((t) => ({ id: t.id, lat: t.lat as number, lng: t.lng as number }))),
    [mappable]
  );

  function selectTrip(id: string | null) {
    setSelectedId(id);
    webviewRef.current?.injectJavaScript(`window.selectTrip(${JSON.stringify(id)}); true;`);
  }

  const selectedTrip = mappable.find((t) => t.id === selectedId) ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topSection}>
        {selectedTrip ? (
          <View style={styles.mcard}>
            <Text style={styles.mcardKey}>{formatDateRange(selectedTrip.start_date, selectedTrip.end_date)}</Text>
            <Text style={styles.mcardTitle}>{tripDisplayName(selectedTrip)}</Text>
          </View>
        ) : (
          mappable.length > 0 && (
            <View style={styles.mcard}>
              <Text style={styles.mcardKey}>Everywhere you've been</Text>
              <Text style={styles.mcardTitle}>
                {mappable.length} trip{mappable.length === 1 ? '' : 's'}
              </Text>
            </View>
          )
        )}

        <View style={styles.header}>
          <Wordmark />
          <Pressable onPress={onOpenProfile} hitSlop={8}>
            <Avatar uri={session ? getAvatarUrl(session.user) : null} size={38} />
          </Pressable>
        </View>

        {mappable.length > 0 && (
          <View style={styles.chips}>
            <Chip label="All time" variant={selectedId === null ? 'on' : 'out'} onPress={() => selectTrip(null)} />
            {mappable.map((t) => (
              <Chip
                key={t.id}
                label={tripDisplayName(t).split(',')[0]}
                variant={selectedId === t.id ? 'on' : 'out'}
                onPress={() => selectTrip(t.id)}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.mapArea}>
        {!isLoading && mappable.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No locations yet</Text>
            <Text style={styles.emptyBody}>
              {error ?? 'Create a trip and pick a location to see it here.'}
            </Text>
          </View>
        ) : (
          <WebView
            ref={webviewRef}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.webview}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg.tripId) setSelectedId(msg.tripId);
              } catch {
                // ignore malformed messages from the page
              }
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topSection: {
    backgroundColor: colors.white,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  mapArea: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xs,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    backgroundColor: colors.fill,
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
  mcard: {
    marginHorizontal: 14,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 13,
  },
  mcardKey: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  mcardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
});
