import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Wordmark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { getAvatarUrl } from '../lib/profile';
import { colors, fontFamily, fontSize, spacing } from '../theme/tokens';

export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const { session } = useAuth();
  const email = session?.user.email ?? 'unknown';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Wordmark />
      </View>

      <View style={styles.body}>
        <View style={styles.avatar}>
          <Avatar uri={session ? getAvatarUrl(session.user) : null} size={82} />
        </View>
        <Text style={styles.eyebrow}>Signed in as</Text>
        <Text style={styles.email}>{email}</Text>
      </View>

      <View style={styles.footer}>
        <Button title="Continue" onPress={onContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingTop: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  avatar: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.xs,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.blue,
    marginBottom: spacing.xs,
  },
  email: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
});
