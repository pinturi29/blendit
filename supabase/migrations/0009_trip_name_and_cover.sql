-- A trip's display name (separate from `destination`, which still drives
-- search/map coordinates) and a cover photo, both optional and editable
-- only by the trip owner (trips_update_own from 0001 already covers the
-- two new columns -- no RLS change needed on trips itself).

alter table public.trips add column if not exists name text;
alter table public.trips add column if not exists cover_photo_url text;

-- One cover photo per trip ("<trip id>.jpg", upsert on re-upload), same
-- shape as the avatars bucket in 0007_avatar_storage.sql except ownership
-- is checked via a trips subquery -- the object name encodes a trip id,
-- not a user id.
insert into storage.buckets (id, name, public)
values ('trip-covers', 'trip-covers', true)
on conflict (id) do nothing;

create policy "trip_cover_public_read" on storage.objects
  for select using (bucket_id = 'trip-covers');

create policy "trip_cover_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'trip-covers'
    and exists (
      select 1 from public.trips t
      where t.owner_id = auth.uid() and name = t.id::text || '.jpg'
    )
  );

create policy "trip_cover_owner_update" on storage.objects
  for update using (
    bucket_id = 'trip-covers'
    and exists (
      select 1 from public.trips t
      where t.owner_id = auth.uid() and name = t.id::text || '.jpg'
    )
  );
