import { useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '../theme/tokens';

// Shared tab bar with a thin underline that glides between tabs (sized to
// each tab's own measured width) instead of just appearing/disappearing --
// used by HomeScreen's "All trips / Archived / Invites" and
// TripViewScreen's "Blend / Itinerary / Plan my trip". `equalWidth` picks
// between HomeScreen's left-packed, content-sized tabs and TripViewScreen's
// equal-width centered segments -- the animation logic underneath is
// identical either way, since it just measures whatever layout each tab
// actually renders at.
export function SlidingUnderlineTabs<T extends string>({
  tabs,
  active,
  onChange,
  equalWidth = false,
}: {
  tabs: Array<{ key: T; label: string }>;
  active: T;
  onChange: (key: T) => void;
  equalWidth?: boolean;
}) {
  const layouts = useRef<Partial<Record<T, { x: number; width: number }>>>({});
  const underlineX = useRef(new Animated.Value(0)).current;
  const underlineWidth = useRef(new Animated.Value(0)).current;
  const [underlineReady, setUnderlineReady] = useState(false);

  function animateTo(key: T) {
    const layout = layouts.current[key];
    if (!layout) return;
    Animated.parallel([
      Animated.timing(underlineX, { toValue: layout.x, duration: 220, useNativeDriver: false }),
      Animated.timing(underlineWidth, { toValue: layout.width, duration: 220, useNativeDriver: false }),
    ]).start();
  }

  function handleLayout(key: T, e: LayoutChangeEvent) {
    const { x, width } = e.nativeEvent.layout;
    layouts.current[key] = { x, width };
    if (key === active && !underlineReady) {
      underlineX.setValue(x);
      underlineWidth.setValue(width);
      setUnderlineReady(true);
    }
  }

  return (
    <View style={[styles.tabsRow, equalWidth && styles.tabsRowEqual]}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => {
            onChange(tab.key);
            animateTo(tab.key);
          }}
          onLayout={(e) => handleLayout(tab.key, e)}
          style={[styles.tabBtn, equalWidth && styles.tabBtnEqual]}
          hitSlop={6}
        >
          <Text style={[styles.tabText, active === tab.key && styles.tabTextOn]}>{tab.label}</Text>
        </Pressable>
      ))}
      {underlineReady && (
        <Animated.View style={[styles.tabUnderline, { left: underlineX, width: underlineWidth }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tabsRowEqual: {
    gap: 0,
  },
  tabBtn: {
    paddingBottom: 11,
  },
  tabBtnEqual: {
    flex: 1,
    alignItems: 'center',
  },
  tabText: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.mutedSoft,
  },
  tabTextOn: {
    fontFamily: fontFamily.bold,
    color: colors.navy,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.navy,
  },
});
