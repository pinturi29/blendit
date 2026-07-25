import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { Button, Card, TextField, Wordmark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { colors, fontFamily, fontSize, spacing } from '../theme/tokens';

export function SignUpScreen({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignUp() {
    setError(null);
    setIsSubmitting(true);
    const { error: signUpError } = await signUp(email.trim(), password);
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError);
      return;
    }
    // If email confirmation is required, Supabase won't return a session yet.
    setConfirmationSent(true);
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DismissKeyboardView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Wordmark />
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Takes a few seconds — just an email and a password.</Text>

          {confirmationSent ? (
            <Card>
              <Text style={styles.confirmTitle}>Check your email</Text>
              <Text style={styles.confirmBody}>
                We sent a confirmation link to {email.trim()}. Confirm it, then log in.
              </Text>
            </Card>
          ) : (
            <>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
              />
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="newPassword"
                placeholder="At least 6 characters"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Button
                title="Sign up"
                onPress={handleSignUp}
                loading={isSubmitting}
                disabled={!email || password.length < 6}
              />
            </>
          )}

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <Pressable onPress={onSwitchToLogin}>
              <Text style={styles.switchLink}>Log in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </DismissKeyboardView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.heading,
    color: colors.text,
    marginTop: spacing.xxxl,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.xxxl,
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginBottom: spacing.lg,
  },
  confirmTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.navy,
    marginBottom: spacing.xs,
  },
  confirmBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    lineHeight: 20,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xxl,
  },
  switchText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
  },
  switchLink: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.blue,
  },
});
