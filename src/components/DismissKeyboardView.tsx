import { Keyboard, StyleProp, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';

// Wrap a screen's content in this so tapping anywhere outside an input
// (that isn't itself a button/touchable) dismisses the keyboard. Nested
// Pressables/Buttons still receive their own taps as normal.
export function DismissKeyboardView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={style}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
