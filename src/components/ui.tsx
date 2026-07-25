import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

// "blendit" wordmark — mirrors .mark in the mockup
export function Wordmark() {
  return <Text style={styles.wordmark}>blendit</Text>;
}

// Circular avatar: a real photo when we have a URL, else the app's flat
// placeholder color — shared by every screen that shows someone's identity.
export function Avatar({ uri, size }: { uri: string | null; size: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={shape} />;
  }
  return <View style={[styles.avatarPlaceholder, shape]} />;
}

// Small pencil-in-a-circle overlay for tappable photos (profile avatar,
// trip cover) — indicates "tap to change."
export function EditBadge({ size = 26 }: { size?: number }) {
  return (
    <View style={[styles.editBadge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Svg
        width={size * 0.46}
        height={size * 0.46}
        viewBox="0 0 13 13"
        fill="none"
        stroke={colors.white}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M8.6 1.9 11.1 4.4 4.4 11.1H1.9V8.6z" />
      </Svg>
    </View>
  );
}

type FieldProps = TextInputProps & {
  label: string;
};

// Mirrors .fld / label / .inp in the mockup
export function TextField({ label, style, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.mutedSoft}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
      />
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
};

// Mirrors .btn / .btn.sec in the mockup
export function Button({ title, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  const isSecondary = variant === 'secondary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isSecondary ? styles.buttonSecondary : styles.buttonPrimary,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.navy : colors.white} />
      ) : (
        <Text style={[styles.buttonText, isSecondary ? styles.buttonTextSecondary : styles.buttonTextPrimary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

// Mirrors .card in the mockup
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

type ChipProps = {
  label: string;
  variant?: 'on' | 'off' | 'out';
  onPress?: () => void;
};

// Mirrors .chip / .chip.on / .chip.out in the mockup
export function Chip({ label, variant = 'off', onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        variant === 'on' && styles.chipOn,
        variant === 'out' && styles.chipOut,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          variant === 'out' ? styles.chipTextOut : styles.chipTextOn,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type StepperProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
};

// Mirrors .fld > .inp.stp in the mockup (a numeric field with − / + controls)
export function Stepper({ label, value, onChange, min = 1 }: StepperProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepperRow}>
        <Text style={styles.stepperValue}>{value}</Text>
        <View style={styles.stepperButtons}>
          <Pressable
            style={styles.stepperButton}
            onPress={() => onChange(Math.max(min, value - 1))}
          >
            <Text style={styles.stepperButtonText}>−</Text>
          </Pressable>
          <Pressable style={styles.stepperButton} onPress={() => onChange(value + 1)}>
            <Text style={styles.stepperButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    fontFamily: fontFamily.serif,
    fontSize: fontSize.logo,
    color: colors.navy,
  },
  avatarPlaceholder: {
    backgroundColor: '#A9BFDA',
    borderWidth: 1,
    borderColor: colors.line,
  },
  editBadge: {
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.smd,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 13,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.base,
    color: colors.text,
  },
  button: {
    borderRadius: radii.md,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.navy,
  },
  buttonSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.base,
  },
  buttonTextPrimary: {
    color: colors.white,
  },
  buttonTextSecondary: {
    color: colors.navy,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 15,
    marginBottom: spacing.lg,
  },
  chip: {
    borderRadius: radii.full,
    paddingVertical: 9,
    paddingHorizontal: 15,
    backgroundColor: colors.chip,
  },
  chipOn: {
    backgroundColor: colors.navy,
  },
  chipOut: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipText: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
  },
  chipTextOn: {
    color: colors.white,
  },
  chipTextOut: {
    color: colors.muted,
  },
  stepperRow: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  stepperButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.base,
    color: colors.navy,
  },
});
