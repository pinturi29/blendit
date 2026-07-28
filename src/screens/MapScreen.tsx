import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';

import { Avatar, Wordmark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { emojiForCategory } from '../lib/categoryEmoji';
import { listTripPlaces, PlaceWithVotes } from '../lib/clips';
import { getErrorMessage } from '../lib/errors';
import { getAvatarUrl } from '../lib/profile';
import { listMyTrips, Trip, tripDisplayName } from '../lib/trips';
import { colors, fontFamily, fontSize, spacing } from '../theme/tokens';

type SelectorOption = { key: string | null; label: string };

// Same sliding-underline animation as SlidingUnderlineTabs (Home's "All
// trips / Archived / Invites" and TripView's tab bar) -- not reused
// directly because this one also needs to scroll horizontally through a
// long, dynamic list of trips, which SlidingUnderlineTabs doesn't support.
function TripSelector({
  options,
  active,
  onChange,
}: {
  options: SelectorOption[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  const layouts = useRef<Map<string, { x: number; width: number }>>(new Map());
  const bubbleX = useRef(new Animated.Value(0)).current;
  const bubbleWidth = useRef(new Animated.Value(0)).current;
  const [bubbleReady, setBubbleReady] = useState(false);

  function keyOf(key: string | null) {
    return key ?? '__all__';
  }

  function animateTo(key: string | null) {
    const layout = layouts.current.get(keyOf(key));
    if (!layout) return;
    Animated.parallel([
      Animated.timing(bubbleX, { toValue: layout.x, duration: 220, useNativeDriver: false }),
      Animated.timing(bubbleWidth, { toValue: layout.width, duration: 220, useNativeDriver: false }),
    ]).start();
  }

  function handleLayout(key: string | null, e: LayoutChangeEvent) {
    const { x, width } = e.nativeEvent.layout;
    layouts.current.set(keyOf(key), { x, width });
    if (keyOf(key) === keyOf(active) && !bubbleReady) {
      bubbleX.setValue(x);
      bubbleWidth.setValue(width);
      setBubbleReady(true);
    }
  }

  // Keeps the underline in sync when `active` changes for a reason other
  // than tapping a chip here -- e.g. arriving from "view this place on the
  // map" (Trip Detail's itinerary), which selects a trip programmatically.
  // The onPress handler's own animateTo call covers the tap case; this
  // covers everything else.
  useEffect(() => {
    if (bubbleReady) animateTo(active);
  }, [active, bubbleReady]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>
      {bubbleReady && <Animated.View style={[styles.underline, { left: bubbleX, width: bubbleWidth }]} />}
      {options.map((opt) => {
        const isActive = keyOf(opt.key) === keyOf(active);
        return (
          <Pressable
            key={keyOf(opt.key)}
            onLayout={(e) => handleLayout(opt.key, e)}
            onPress={() => {
              onChange(opt.key);
              animateTo(opt.key);
            }}
            style={styles.selectorItem}
          >
            <Text style={[styles.selectorText, isActive && styles.selectorTextOn]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// No source address is passed -- omitting it is what makes both Apple and
// Google Maps default to "current location" as the starting point, using
// their own location services once the app opens (we don't need our own
// location permission/coordinates for this at all).
async function openDirections(lat: number, lng: number) {
  const nativeUrl =
    Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}&dirflg=d` : `google.navigation:q=${lat},${lng}`;
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const supported = await Linking.canOpenURL(nativeUrl).catch(() => false);
  await Linking.openURL(supported ? nativeUrl : webUrl);
}

type TripPlace = PlaceWithVotes & { clipId: string };

// Bounding region around a set of points, with padding so pins never sit
// flush against the screen edge -- mirrors Leaflet's old fitBounds() padding.
function regionForPoints(points: Array<{ lat: number; lng: number }>): Region {
  if (points.length === 0) {
    return { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(maxLat - minLat, 0.06) * 1.7,
    longitudeDelta: Math.max(maxLng - minLng, 0.06) * 1.7,
  };
}

// The flat navy dot used for "every trip" on the all-time map.
function TripDotMarker() {
  return <View style={styles.tripDot} />;
}


// A dark blue pin with an emoji for its category, and a native callout
// (tap to see the name) instead of a custom HTML popup.
function PlacePinMarker({ category }: { category: string | null }) {
  return (
    <View style={styles.placePin}>
      <Text style={styles.placePinEmoji}>{emojiForCategory(category)}</Text>
    </View>
  );
}

// Where the group is actually staying — dark red so it never gets mistaken
// for a photo pin or a same-trip flat dot.
function HomeBaseMarker() {
  return <View style={styles.homeBaseDot} />;
}

export function MapScreen({
  onOpenProfile,
  initialFocus,
}: {
  onOpenProfile: () => void;
  initialFocus?: { tripId: string; placeId: string };
}) {
  const { session } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tripPlaces, setTripPlaces] = useState<TripPlace[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  // Refetches every time this screen regains focus, not just on mount --
  // otherwise coming back here after voting a place up to full consensus
  // elsewhere wouldn't show the new pin until something else triggered a
  // reload. Only the very first load shows the full-screen spinner.
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnceRef.current) setIsLoading(true);
      listMyTrips()
        .then(setTrips)
        .catch((e) => setError(getErrorMessage(e)))
        .finally(() => {
          setIsLoading(false);
          hasLoadedOnceRef.current = true;
        });
    }, [])
  );

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setHasLocationPermission(status === 'granted');
    });
  }, []);

  // Arriving from "view this place on the map" (Trip Detail's itinerary) --
  // select its trip, and once that trip's places load, zoom tight on the
  // specific one instead of the usual fit-everything view.
  useEffect(() => {
    if (!initialFocus) return;
    setSelectedId(initialFocus.tripId);
    setFocusPlaceId(initialFocus.placeId);
  }, [initialFocus]);

  // Selecting a trip switches the map from "every trip as a dot" to "this
  // trip's fully-agreed-on places as photo pins" -- so places are only
  // fetched once a specific trip is picked, not for every trip up front.
  useEffect(() => {
    if (!selectedId) {
      setTripPlaces([]);
      return;
    }
    setIsLoadingPlaces(true);
    listTripPlaces(selectedId)
      .then(setTripPlaces)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setIsLoadingPlaces(false));
  }, [selectedId]);

  // Also refetch the selected trip's places on refocus (e.g. coming back
  // after voting one up to full consensus in ClipDetailScreen) -- the
  // effect above only reruns when selectedId itself changes, which it
  // won't if you're returning to the same trip you already had selected.
  useFocusEffect(
    useCallback(() => {
      if (!selectedId) return;
      listTripPlaces(selectedId)
        .then(setTripPlaces)
        .catch((e) => setError(getErrorMessage(e)));
    }, [selectedId])
  );

  const mappable = useMemo(() => trips.filter((t) => t.lat != null && t.lng != null), [trips]);
  const selectedTrip = useMemo(() => trips.find((t) => t.id === selectedId) ?? null, [trips, selectedId]);

  // Only pins places the group has fully agreed on — every person voted,
  // and every vote was up — not just "more ups than downs."
  const pinnedPlaces = useMemo(
    () =>
      tripPlaces.filter(
        (p) => p.lat != null && p.lng != null && p.downCount === 0 && p.upCount >= (selectedTrip?.party_size ?? 1)
      ),
    [tripPlaces, selectedTrip]
  );

  const homeBasePoint = useMemo(
    () =>
      selectedTrip?.home_base_lat != null && selectedTrip?.home_base_lng != null
        ? { lat: selectedTrip.home_base_lat, lng: selectedTrip.home_base_lng }
        : null,
    [selectedTrip]
  );

  const activePoints = useMemo(() => {
    if (selectedId === null) return mappable.map((t) => ({ lat: t.lat as number, lng: t.lng as number }));
    const points = pinnedPlaces.map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
    return homeBasePoint ? [...points, homeBasePoint] : points;
  }, [selectedId, mappable, pinnedPlaces, homeBasePoint]);

  // Recenter/refit the map whenever the visible dataset changes (switching
  // trips, or data finishing a load) — but only then, so the user's own
  // pan/zoom in between isn't fought by a controlled region prop. Gated on
  // isMapReady because react-native-maps silently drops
  // animateToRegion/fitToCoordinates calls made before the native map view
  // has actually finished initializing -- which, coming from "view this
  // place on the map", is almost immediately after MapView itself mounts.
  useEffect(() => {
    if (!isMapReady) return;

    // A pending focus request always wins, but only once it can actually be
    // resolved -- if the target's own data hasn't loaded yet (pinnedPlaces
    // still empty while e.g. a home base point alone makes activePoints
    // non-empty), wait for the next update instead of falling through to a
    // "fit everything so far" zoom that would silently consume/mask it.
    if (focusPlaceId) {
      const target = pinnedPlaces.find((p) => p.id === focusPlaceId);
      if (!target || target.lat == null || target.lng == null) return;
      mapRef.current?.animateToRegion(
        { latitude: target.lat, longitude: target.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500
      );
      setFocusPlaceId(null); // consumed — don't keep re-zooming on later chip taps
      return;
    }

    if (activePoints.length === 0) return;
    mapRef.current?.fitToCoordinates(
      activePoints.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 80, left: 60, right: 60, bottom: 80 }, animated: true }
    );
  }, [activePoints, pinnedPlaces, focusPlaceId, isMapReady]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topSection}>
        <View style={styles.header}>
          <Wordmark />
          <Pressable onPress={onOpenProfile} hitSlop={8}>
            <Avatar uri={session ? getAvatarUrl(session.user) : null} size={38} />
          </Pressable>
        </View>

        {mappable.length > 0 && (
          <TripSelector
            options={[
              { key: null, label: 'All time' },
              ...mappable.map((t) => ({ key: t.id, label: tripDisplayName(t).split(',')[0] })),
            ]}
            active={selectedId}
            onChange={setSelectedId}
          />
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
        ) : selectedId !== null && !isLoadingPlaces && pinnedPlaces.length === 0 && !homeBasePoint ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No spots fully agreed on yet</Text>
            <Text style={styles.emptyBody}>
              Once everyone in the group votes a place up with no downvotes, it lands here.
            </Text>
          </View>
        ) : (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={regionForPoints(activePoints)}
              rotateEnabled={false}
              showsUserLocation={hasLocationPermission}
              showsMyLocationButton={hasLocationPermission}
              onMapReady={() => setIsMapReady(true)}
            >
              {selectedId === null
                ? mappable.map((t) => (
                    <Marker
                      key={t.id}
                      coordinate={{ latitude: t.lat as number, longitude: t.lng as number }}
                      onPress={() => setSelectedId(t.id)}
                      tracksViewChanges={false}
                    >
                      <TripDotMarker />
                    </Marker>
                  ))
                : [
                    ...pinnedPlaces.map((p) => (
                      <Marker
                        key={p.id}
                        coordinate={{ latitude: p.lat as number, longitude: p.lng as number }}
                        title={p.name}
                        description="Tap for directions"
                        onCalloutPress={() => openDirections(p.lat as number, p.lng as number)}
                      >
                        <PlacePinMarker category={p.category} />
                      </Marker>
                    )),
                    homeBasePoint && (
                      <Marker
                        key="home-base"
                        coordinate={{ latitude: homeBasePoint.lat, longitude: homeBasePoint.lng }}
                        title={selectedTrip?.home_base_label ?? 'Home base'}
                        description="Tap for directions"
                        onCalloutPress={() => openDirections(homeBasePoint.lat, homeBasePoint.lng)}
                        tracksViewChanges={false}
                      >
                        <HomeBaseMarker />
                      </Marker>
                    ),
                  ]}
            </MapView>
            {selectedId !== null && isLoadingPlaces && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color={colors.navy} />
              </View>
            )}
          </>
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
  map: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.xs,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  underline: {
    position: 'absolute',
    bottom: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.navy,
  },
  selectorItem: {
    paddingVertical: 9,
    paddingHorizontal: 15,
  },
  selectorText: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.mutedSoft,
  },
  selectorTextOn: {
    fontFamily: fontFamily.bold,
    color: colors.navy,
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
  tripDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.navy,
    borderWidth: 4,
    borderColor: colors.white,
    shadowColor: colors.navy,
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  placePin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.navy,
    shadowOpacity: 0.4,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  placePinEmoji: {
    fontSize: 20,
  },
  homeBaseDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#8B1E1E',
    borderWidth: 4,
    borderColor: colors.white,
    shadowColor: '#8B1E1E',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
