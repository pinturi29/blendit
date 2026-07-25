-- Fixes "new row violates row-level security policy" on every cover photo
-- upload. trip_cover_owner_insert/update compared the bare column `name`
-- against `t.id::text || '.jpg'` inside a correlated subquery over
-- public.trips -- but trips itself has a `name` column (added in this same
-- migration set, 0009), so Postgres resolved the unqualified `name` to
-- `t.name` (the trip's own display name) instead of the outer
-- storage.objects.name, making the check effectively always false.
-- Fix: qualify it explicitly as storage.objects.name.

drop policy if exists "trip_cover_owner_insert" on storage.objects;
create policy "trip_cover_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'trip-covers'
    and exists (
      select 1 from public.trips t
      where t.owner_id = auth.uid() and storage.objects.name = t.id::text || '.jpg'
    )
  );

drop policy if exists "trip_cover_owner_update" on storage.objects;
create policy "trip_cover_owner_update" on storage.objects
  for update using (
    bucket_id = 'trip-covers'
    and exists (
      select 1 from public.trips t
      where t.owner_id = auth.uid() and storage.objects.name = t.id::text || '.jpg'
    )
  );
