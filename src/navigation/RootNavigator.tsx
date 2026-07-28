import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { ClipDetailScreen } from '../screens/ClipDetailScreen';
import { CreateTripScreen } from '../screens/CreateTripScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { TabsScreen } from '../screens/TabsScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { TripViewScreen } from '../screens/TripViewScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { colors } from '../theme/tokens';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
type Nav = NativeStackNavigationProp<RootStackParamList>;

function LoginRoute() {
  const navigation = useNavigation<Nav>();
  return <LoginScreen onSwitchToSignUp={() => navigation.navigate('SignUp')} />;
}

function SignUpRoute() {
  const navigation = useNavigation<Nav>();
  return <SignUpScreen onSwitchToLogin={() => navigation.navigate('Login')} />;
}

function CreateTripRoute() {
  const navigation = useNavigation<Nav>();
  return <CreateTripScreen onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}

function ProfileRoute() {
  const navigation = useNavigation<Nav>();
  return <ProfileScreen onBack={() => navigation.goBack()} />;
}

function TripDetailRoute() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'TripDetail'>>();
  return (
    <TripDetailScreen
      tripId={route.params.tripId}
      onBack={() => navigation.goBack()}
      onDeleted={() => navigation.navigate('Tabs')}
      onViewTrip={() => navigation.navigate('TripView', { tripId: route.params.tripId })}
    />
  );
}

function TripViewRoute() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'TripView'>>();
  return (
    <TripViewScreen
      tripId={route.params.tripId}
      onBack={() => navigation.goBack()}
      onOpenClip={(clipId) => navigation.navigate('ClipDetail', { clipId })}
      onViewOnMap={(tripId, placeId) =>
        navigation.navigate('Tabs', { focusMapTripId: tripId, focusMapPlaceId: placeId })
      }
    />
  );
}

function ClipDetailRoute() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'ClipDetail'>>();
  return <ClipDetailScreen clipId={route.params.clipId} onBack={() => navigation.goBack()} />;
}

export function RootNavigator() {
  const { session, isLoading } = useAuth();
  const [hasContinued, setHasContinued] = useState(false);

  // Show the welcome interstitial again next time someone signs in.
  useEffect(() => {
    if (!session) setHasContinued(false);
  }, [session]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!session ? (
        <>
          <Stack.Screen name="Login" component={LoginRoute} />
          <Stack.Screen name="SignUp" component={SignUpRoute} />
        </>
      ) : !hasContinued ? (
        <Stack.Screen name="Welcome">
          {() => <WelcomeScreen onContinue={() => setHasContinued(true)} />}
        </Stack.Screen>
      ) : (
        <>
          <Stack.Screen name="Tabs" component={TabsScreen} />
          <Stack.Screen name="CreateTrip" component={CreateTripRoute} />
          <Stack.Screen name="Profile" component={ProfileRoute} />
          <Stack.Screen name="TripDetail" component={TripDetailRoute} />
          <Stack.Screen name="TripView" component={TripViewRoute} />
          <Stack.Screen name="ClipDetail" component={ClipDetailRoute} />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
});
