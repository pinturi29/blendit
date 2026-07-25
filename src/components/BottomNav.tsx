import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, spacing } from '../theme/tokens';

function TripsIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round">
      <Rect x={2.6} y={6} width={16.8} height={12.6} rx={2.6} />
      <Path d="M7.6 6V4.6A1.8 1.8 0 0 1 9.4 2.8h3.2a1.8 1.8 0 0 1 1.8 1.8V6" />
    </Svg>
  );
}

function MapIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round">
      <Path d="M2.6 5.6 8 3.4v13l-5.4 2.2z" />
      <Path d="M8 3.4 14 5.6v13L8 16.4z" />
      <Path d="M14 5.6 19.4 3.4v13l-5.4 2.2z" />
    </Svg>
  );
}

function PlusIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2.4} strokeLinecap="round">
      <Path d="M12 4.6v14.8M4.6 12h14.8" />
    </Svg>
  );
}

type BottomNavProps = {
  active: 'trips' | 'map';
  onSelectTrips: () => void;
  onSelectMap: () => void;
  onCreate: () => void;
};

// Mirrors .nav / .cluster / .pill / .fab in the mockup
export function BottomNav({ active, onSelectTrips, onSelectMap, onCreate }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingBottom: spacing.xxxl + insets.bottom }]} pointerEvents="box-none">
      <View style={styles.cluster}>
        <Pressable
          style={[styles.pill, active === 'trips' && styles.pillOn]}
          onPress={onSelectTrips}
        >
          <TripsIcon color={active === 'trips' ? colors.white : colors.navy} />
        </Pressable>
        <Pressable style={[styles.pill, active === 'map' && styles.pillOn]} onPress={onSelectMap}>
          <MapIcon color={active === 'map' ? colors.white : colors.navy} />
        </Pressable>
      </View>
      <Pressable style={styles.fab} onPress={onCreate}>
        <PlusIcon />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cluster: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.navy,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pillOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  fab: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.navy,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
