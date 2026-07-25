import { User } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

export function getDisplayName(user: User): string {
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  return user.email ?? 'You';
}

export function getAvatarUrl(user: User): string | null {
  const avatarUrl = user.user_metadata?.avatar_url;
  return typeof avatarUrl === 'string' && avatarUrl ? avatarUrl : null;
}

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

// Batched lookups against the public `profiles` table (mirrors auth.users,
// since that schema itself isn't queryable) — one request per screen
// instead of one per row. RLS scopes results to yourself plus anyone you
// share a trip with, so entries for people outside that may simply be
// missing from the returned map.
export async function getProfilesByIds(ids: string[]): Promise<Record<string, Profile>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('*').in('id', uniqueIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [p.id, p as Profile]));
}

export async function getProfilesByEmails(emails: string[]): Promise<Record<string, Profile>> {
  const uniqueEmails = [...new Set(emails)];
  if (uniqueEmails.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('*').in('email', uniqueEmails);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [p.email, p as Profile]));
}

export async function updateDisplayName(name: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) throw error;
}

// Opens the native photo library picker with a square crop/zoom editor, then
// uploads to a per-user path in the "avatars" bucket (upsert, so re-uploads
// replace the same file instead of leaving orphans) and saves the resulting
// URL on the user's account. Returns null if the user cancels or denies
// photo-library access.
export async function pickAndUploadAvatar(userId: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled) return null;

  const uri = result.assets[0].uri;
  const arrayBuffer = await fetch(uri).then((res) => res.arrayBuffer());
  const path = `${userId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = `${publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });
  if (updateError) throw updateError;

  return avatarUrl;
}
