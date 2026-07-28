import { StyleProp, View, ViewStyle } from 'react-native';

// Every screen using this wraps a single ScrollView/FlatList as the child --
// that scrollable is given keyboardDismissMode="on-drag" at each call site
// so starting to scroll dismisses the keyboard. This used to also wrap
// children in a TouchableWithoutFeedback (dismiss on tap), but a
// TouchableWithoutFeedback ancestor steals the pan gesture from a nested
// ScrollView/FlatList in React Native -- the symptom is only being able to
// scroll by dragging exactly on the native scroll indicator at the screen's
// right edge. Keeping this component (rather than inlining a plain View at
// each call site) means call sites don't need to change at all.
export function DismissKeyboardView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}
