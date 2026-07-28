import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { BottomNav } from '../components/BottomNav';
import { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/tokens';
import { HomeScreen } from './HomeScreen';
import { MapScreen } from './MapScreen';

type Tab = 'trips' | 'map';
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TabsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Tabs'>>();
  const [tab, setTab] = useState<Tab>('trips');
  const [mapFocus, setMapFocus] = useState<{ tripId: string; placeId: string } | null>(null);
  const opacity = useRef(new Animated.Value(1)).current;

  const focusMapTripId = route.params?.focusMapTripId;
  const focusMapPlaceId = route.params?.focusMapPlaceId;

  // Coming from "view this place on the map" (Trip Detail's itinerary) --
  // jump straight to the Map tab. The focus target is captured into local
  // state (not read straight from route.params on every render) because we
  // clear the params in the same update, so navigating back to Tabs later
  // (e.g. via the bottom nav itself) doesn't keep re-focusing the same
  // place -- MapScreen needs to see the target at least once, though, so
  // clearing can't happen before this state is set.
  useEffect(() => {
    if (!focusMapTripId || !focusMapPlaceId) return;
    setTab('map');
    setMapFocus({ tripId: focusMapTripId, placeId: focusMapPlaceId });
    navigation.setParams({ focusMapTripId: undefined, focusMapPlaceId: undefined });
  }, [focusMapTripId, focusMapPlaceId, navigation]);

  function switchTab(next: Tab) {
    if (next === tab) return;
    Animated.timing(opacity, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setTab(next);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    });
  }

  return (
    <View style={styles.flex}>
      <Animated.View style={[styles.flex, { opacity }]}>
        {tab === 'trips' ? (
          <HomeScreen
            onOpenProfile={() => navigation.navigate('Profile')}
            onOpenTrip={(tripId) => navigation.navigate('TripDetail', { tripId })}
            onOpenBlend={(tripId) => navigation.navigate('TripView', { tripId })}
          />
        ) : (
          <MapScreen onOpenProfile={() => navigation.navigate('Profile')} initialFocus={mapFocus ?? undefined} />
        )}
      </Animated.View>
      <BottomNav
        active={tab}
        onSelectTrips={() => switchTab('trips')}
        onSelectMap={() => switchTab('map')}
        onCreate={() => navigation.navigate('CreateTrip')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.white,
  },
});
