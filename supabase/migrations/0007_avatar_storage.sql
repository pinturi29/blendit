-- Profile photo storage. One file per user, named "<user id>.jpg" so a
-- re-upload (upsert) always replaces the same object instead of leaving
-- orphans behind. Publicly readable (avatars are meant to be seen by other
-- trip members), but only the owning user can write their own file.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatar_owner_insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

create policy "avatar_owner_update" on storage.objects
  for update using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
