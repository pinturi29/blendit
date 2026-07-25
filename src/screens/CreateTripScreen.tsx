import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DateField } from '../components/DateField';
import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { PlaceField } from '../components/PlaceField';
import { Button, Card, Stepper, TextField } from '../components/ui';
import { getErrorMessage } from '../lib/errors';
import { pickTripCoverPhoto, uploadTripCoverPhoto } from '../lib/tripCover';
import { createTripWithInvites } from '../lib/trips';
import { colors, fontFamily, fontSize, spacing } from '../theme/tokens';

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

type Step = 'basics' | 'invite';

function StepHeader({
  title,
  step,
  onBack,
}: {
  title: string;
  step: 1 | 2;
  onBack: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.headerStep}>{step} of 2</Text>
    </View>
  );
}

export function CreateTripScreen({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('basics');

  const [destination, setDestination] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [tripName, setTripName] = useState('');
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => addDays(new Date(), 7));
  const [partySize, setPartySize] = useState(2);
  const [description, setDescription] = useState('');
  const [basicsError, setBasicsError] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleNext() {
    if (!destination.trim()) {
      setBasicsError('Add a destination.');
      return;
    }
    if (endDate < startDate) {
      setBasicsError('Return date is before the leave date.');
      return;
    }
    setBasicsError(null);
    setStep('invite');
  }

  function handleAddEmail() {
    const email = emailInput.trim().toLowerCase();
    if (!email || inviteEmails.includes(email)) {
      setEmailInput('');
      return;
    }
    setInviteEmails((prev) => [...prev, email]);
    setEmailInput('');
  }

  function handleRemoveEmail(email: string) {
    setInviteEmails((prev) => prev.filter((e) => e !== email));
  }

  async function handlePickCover() {
    const uri = await pickTripCoverPhoto();
    if (uri) setCoverUri(uri);
  }

  async function handleCreate() {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const trip = await createTripWithInvites({
        destination: destination.trim(),
        name: tripName,
        lat: coords?.lat ?? null,
        lng: coords?.lon ?? null,
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
        partySize,
        description: description.trim(),
        inviteEmails,
      });
      if (coverUri) {
        try {
          await uploadTripCoverPhoto(trip.id, coverUri);
        } catch (e) {
          Alert.alert(
            'Trip created',
            `The trip is set up, but the cover photo didn't upload: ${getErrorMessage(e)}. You can add it from the trip page.`
          );
        }
      }
      onDone();
    } catch (e) {
      setSubmitError(getErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 'basics') {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StepHeader title="New trip" step={1} onBack={onCancel} />
        <DismissKeyboardView style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <PlaceField
              label="Where are you going"
              value={destination}
              onChangeText={(text) => {
                setDestination(text);
                setCoords(null);
              }}
              onSelect={(place) => {
                setDestination(place.label);
                setCoords({ lat: place.lat, lon: place.lon });
              }}
              placeholder="Tokyo, Japan"
            />
            <TextField
              label="Trip name (optional)"
              value={tripName}
              onChangeText={setTripName}
              placeholder="Senior Spring Tokyo"
            />
            <View style={styles.field}>
              <Text style={styles.label}>Cover photo (optional)</Text>
              <Pressable onPress={handlePickCover}>
                {coverUri ? (
                  <Image source={{ uri: coverUri }} style={styles.coverPreview} />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <Text style={styles.coverPlaceholderText}>Add a cover photo</Text>
                  </View>
                )}
              </Pressable>
            </View>
            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <DateField label="Leaving" value={startDate} onChange={setStartDate} />
              </View>
              <View style={styles.pairItem}>
                <DateField label="Coming back" value={endDate} onChange={setEndDate} minimumDate={startDate} />
              </View>
            </View>
            <Stepper label="How many of you" value={partySize} onChange={setPartySize} min={1} />
            <TextField
              label="What's the trip for"
              value={description}
              onChangeText={setDescription}
              placeholder="Food first, one big temple day…"
              multiline
              numberOfLines={3}
              style={styles.textarea}
            />
            {basicsError ? <Text style={styles.error}>{basicsError}</Text> : null}
          </ScrollView>
        </DismissKeyboardView>
        <View style={styles.footer}>
          <Button title="Next — invite the group" onPress={handleNext} />
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StepHeader title="Who's coming" step={2} onBack={() => setStep('basics')} />
      <DismissKeyboardView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={styles.cardTitle}>Everyone votes, not just you</Text>
            <Text style={styles.cardBody}>
              Anyone you invite here can see this trip the moment they log into blendit with that
              email — no separate link to send.
            </Text>
          </Card>

          <TextField
            label="Invite by email"
            value={emailInput}
            onChangeText={setEmailInput}
            placeholder="friend@example.com"
            keyboardType="email-address"
            onSubmitEditing={handleAddEmail}
            returnKeyType="done"
          />
          <Button title="Add to trip" variant="secondary" onPress={handleAddEmail} />

          {inviteEmails.length > 0 && (
            <View style={styles.inviteList}>
              {inviteEmails.map((email) => (
                <View key={email} style={styles.inviteRow}>
                  <Text style={styles.inviteEmail}>{email}</Text>
                  <Pressable onPress={() => handleRemoveEmail(email)} hitSlop={8}>
                    <Text style={styles.inviteRemove}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
        </ScrollView>
      </DismissKeyboardView>
      <View style={styles.footer}>
        <Button title="Create trip" onPress={handleCreate} loading={isSubmitting} />
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  back: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    color: colors.navy,
    width: 32,
  },
  headerTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    color: colors.text,
  },
  headerStep: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.mutedSoft,
    width: 48,
    textAlign: 'right',
  },
  scroll: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
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
  coverPreview: {
    width: '100%',
    height: 140,
    borderRadius: 9,
  },
  coverPlaceholder: {
    width: '100%',
    height: 140,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholderText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.muted,
  },
  pair: {
    flexDirection: 'row',
    gap: 10,
  },
  pairItem: {
    flex: 1,
  },
  textarea: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  error: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: '#C23B3B',
    marginTop: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17.5,
    color: colors.navy,
    marginBottom: spacing.xs,
  },
  cardBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.muted,
    lineHeight: 20,
  },
  inviteList: {
    marginTop: spacing.lg,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  inviteEmail: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.text,
  },
  inviteRemove: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.blue,
  },
});
