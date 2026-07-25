import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

// Opens the native photo library picker with a landscape crop/zoom editor
// and returns the local file URI, or null if canceled/denied. Doesn't
// upload — during trip creation there's no trip id yet to upload against.
export async function pickTripCoverPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
  });
  if (result.canceled) return null;

  return result.assets[0].uri;
}

// Uploads a locally-picked photo (see pickTripCoverPhoto) to the trip's
// cover slot and saves the URL on the trip row. One file per trip
// (upsert), so re-uploads replace it instead of leaving orphans.
export async function uploadTripCoverPhoto(tripId: string, localUri: string): Promise<string> {
  const arrayBuffer = await fetch(localUri).then((res) => res.arrayBuffer());
  const path = `${tripId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('trip-covers')
    .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('trip-covers').getPublicUrl(path);
  const coverUrl = `${publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase
    .from('trips')
    .update({ cover_photo_url: coverUrl })
    .eq('id', tripId);
  if (updateError) throw updateError;

  return coverUrl;
}

// Convenience for editing an existing trip (TripDetailScreen) — pick and
// upload in one step, since the trip id already exists there.
export async function pickAndUploadTripCoverPhoto(tripId: string): Promise<string | null> {
  const uri = await pickTripCoverPhoto();
  if (!uri) return null;
  return uploadTripCoverPhoto(tripId, uri);
}
