import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('trips');
  const opacity = useRef(new Animated.Value(1)).current;

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
          <MapScreen onOpenProfile={() => navigation.navigate('Profile')} />
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
