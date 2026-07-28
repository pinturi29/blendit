export type RootStackParamList = {
  Login: undefined;
  SignUp: undefined;
  Welcome: undefined;
  Tabs: { focusMapTripId?: string; focusMapPlaceId?: string } | undefined;
  CreateTrip: undefined;
  Profile: undefined;
  TripDetail: { tripId: string };
  TripView: { tripId: string };
  ClipDetail: { clipId: string };
};
