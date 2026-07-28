-- Consolidated baseline schema for blendit, replacing the old 0001-0020
-- migration sequence (19 files, several of which were pure fixes on top of
-- earlier ones). This file represents the exact same end state those 19
-- produced together -- same tables/columns, same RLS policies, same
-- functions/triggers, same storage buckets, same realtime publication
-- membership. Every statement is written defensively (if not exists / drop
-- then create / on conflict do nothing) so this is safe to run again
-- against a database that already has this schema, or against a brand new
-- one -- either way it converges to the same result.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  destination text not null,
  start_date date not null,
  end_date date not null,
  party_size integer not null default 1,
  description text,
  created_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  name text,
  cover_photo_url text,
  home_base_label text,
  home_base_lat double precision,
  home_base_lng double precision
);

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  email text not null,
  status text not null default 'invited' check (status in ('invited', 'joined')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  label text not null,
  lat double precision,
  lng double precision,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_clips (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  shared_by uuid not null references auth.users (id) on delete cascade,
  source text not null default 'TikTok' check (source in ('TikTok', 'Instagram Reels')),
  url text not null,
  title text,
  description text,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  summary text,
  location_name text,
  lat double precision,
  lng double precision,
  error_message text,
  processing_started_at timestamptz,
  thumbnail_url text,
  author text
);

create table if not exists public.trip_clip_votes (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.trip_clips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.clip_places (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.trip_clips (id) on delete cascade,
  name text not null,
  category text,
  location_name text,
  lat double precision,
  lng double precision,
  rank int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.clip_place_votes (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.clip_places (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  unique (place_id, user_id)
);

create table if not exists public.trip_itineraries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  wake_time text not null default '09:00',
  sleep_time text not null default '23:00',
  days jsonb,
  error_message text,
  requested_by uuid not null references auth.users (id) on delete cascade,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trips enable row level security;
alter table public.trip_invites enable row level security;
alter table public.trip_stops enable row level security;
alter table public.trip_clips enable row level security;
alter table public.trip_clip_votes enable row level security;
alter table public.profiles enable row level security;
alter table public.clip_places enable row level security;
alter table public.clip_place_votes enable row level security;
alter table public.trip_itineraries enable row level security;

-- ============================================================
-- Policies -- trips
-- ============================================================

drop policy if exists "trips_select_own_or_invited" on public.trips;
create policy "trips_select_own_or_invited" on public.trips
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trip_invites ti
      where ti.trip_id = trips.id and ti.email = auth.jwt() ->> 'email'
    )
  );

drop policy if exists "trips_insert_own" on public.trips;
create policy "trips_insert_own" on public.trips
  for insert with check (owner_id = auth.uid());

-- Any trip member may update name/dates; a trigger below (not this policy)
-- is what actually stops a non-owner from touching any other column.
drop policy if exists "trips_update_own" on public.trips;
create policy "trips_update_own" on public.trips
  for update using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trip_invites ti
      where ti.trip_id = trips.id and ti.email = auth.jwt() ->> 'email'
    )
  );

drop policy if exists "trips_delete_own" on public.trips;
create policy "trips_delete_own" on public.trips
  for delete using (owner_id = auth.uid());

-- ============================================================
-- Policies -- trip_invites
-- ============================================================

-- Does NOT query public.trips -- trips' own select policy queries
-- trip_invites, and that combination causes "infinite recursion detected in
-- policy for relation trips". Not needed anyway: invited_by is always the
-- trip owner (see createTripWithInvites), so invited_by = auth.uid()
-- already covers it.
drop policy if exists "trip_invites_select" on public.trip_invites;
create policy "trip_invites_select" on public.trip_invites
  for select using (
    invited_by = auth.uid()
    or email = auth.jwt() ->> 'email'
  );

drop policy if exists "trip_invites_insert_owner" on public.trip_invites;
create policy "trip_invites_insert_owner" on public.trip_invites
  for insert with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid()
    )
  );

-- An invited person can update their own invite row (used to accept: sets
-- status to 'joined').
drop policy if exists "trip_invites_update_self" on public.trip_invites;
create policy "trip_invites_update_self" on public.trip_invites
  for update using (email = auth.jwt() ->> 'email')
  with check (email = auth.jwt() ->> 'email');

-- Either the trip owner or the invited person themself can delete an
-- invite row -- covers both "owner removes a member" and "I reject an
-- invite".
drop policy if exists "trip_invites_delete" on public.trip_invites;
create policy "trip_invites_delete" on public.trip_invites
  for delete using (
    invited_by = auth.uid()
    or email = auth.jwt() ->> 'email'
  );

-- ============================================================
-- Policies -- trip_stops
-- ============================================================

drop policy if exists "trip_stops_select" on public.trip_stops;
create policy "trip_stops_select" on public.trip_stops
  for select using (
    exists (
      select 1 from public.trips t
      where t.id = trip_stops.trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_stops_insert" on public.trip_stops;
create policy "trip_stops_insert" on public.trip_stops
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

-- Whoever added a stop can remove it; so can the trip owner.
drop policy if exists "trip_stops_delete" on public.trip_stops;
create policy "trip_stops_delete" on public.trip_stops
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_stops.trip_id and t.owner_id = auth.uid()
    )
  );

-- ============================================================
-- Policies -- trip_clips / trip_clip_votes
-- ============================================================

drop policy if exists "trip_clips_select" on public.trip_clips;
create policy "trip_clips_select" on public.trip_clips
  for select using (
    exists (
      select 1 from public.trips t
      where t.id = trip_clips.trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_clips_insert" on public.trip_clips;
create policy "trip_clips_insert" on public.trip_clips
  for insert with check (
    shared_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_clips_delete" on public.trip_clips;
create policy "trip_clips_delete" on public.trip_clips
  for delete using (
    shared_by = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_clips.trip_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "trip_clip_votes_select" on public.trip_clip_votes;
create policy "trip_clip_votes_select" on public.trip_clip_votes
  for select using (
    exists (
      select 1 from public.trip_clips c
      join public.trips t on t.id = c.trip_id
      where c.id = trip_clip_votes.clip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_clip_votes_insert_own" on public.trip_clip_votes;
create policy "trip_clip_votes_insert_own" on public.trip_clip_votes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.trip_clips c
      join public.trips t on t.id = c.trip_id
      where c.id = clip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_clip_votes_update_own" on public.trip_clip_votes;
create policy "trip_clip_votes_update_own" on public.trip_clip_votes
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "trip_clip_votes_delete_own" on public.trip_clip_votes;
create policy "trip_clip_votes_delete_own" on public.trip_clip_votes
  for delete using (user_id = auth.uid());

-- ============================================================
-- Policies -- profiles
-- ============================================================

-- Visible to yourself, or to anyone who shares a trip with you (same
-- "owner or invited" membership test used throughout). Doesn't get queried
-- back by trips/trip_invites' own policies, so no recursion risk.
drop policy if exists "profiles_select_trip_mates" on public.profiles;
create policy "profiles_select_trip_mates" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.trips t
      where
        (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites mine
            where mine.trip_id = t.id and mine.email = auth.jwt() ->> 'email'
          )
        )
        and (
          t.owner_id = profiles.id
          or exists (
            select 1 from public.trip_invites theirs
            where theirs.trip_id = t.id and theirs.email = profiles.email
          )
        )
    )
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ============================================================
-- Policies -- clip_places / clip_place_votes
-- ============================================================

-- Only the worker (service role, bypasses RLS entirely) ever inserts
-- places -- no client-facing insert/update/delete policy needed here.
drop policy if exists "clip_places_select" on public.clip_places;
create policy "clip_places_select" on public.clip_places
  for select using (
    exists (
      select 1 from public.trip_clips c
      join public.trips t on t.id = c.trip_id
      where c.id = clip_places.clip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "clip_place_votes_select" on public.clip_place_votes;
create policy "clip_place_votes_select" on public.clip_place_votes
  for select using (
    exists (
      select 1 from public.clip_places p
      join public.trip_clips c on c.id = p.clip_id
      join public.trips t on t.id = c.trip_id
      where p.id = clip_place_votes.place_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "clip_place_votes_insert_own" on public.clip_place_votes;
create policy "clip_place_votes_insert_own" on public.clip_place_votes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.clip_places p
      join public.trip_clips c on c.id = p.clip_id
      join public.trips t on t.id = c.trip_id
      where p.id = place_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "clip_place_votes_update_own" on public.clip_place_votes;
create policy "clip_place_votes_update_own" on public.clip_place_votes
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "clip_place_votes_delete_own" on public.clip_place_votes;
create policy "clip_place_votes_delete_own" on public.clip_place_votes
  for delete using (user_id = auth.uid());

-- ============================================================
-- Policies -- trip_itineraries
-- ============================================================

drop policy if exists "trip_itineraries_select" on public.trip_itineraries;
create policy "trip_itineraries_select" on public.trip_itineraries
  for select using (
    exists (
      select 1 from public.trips t
      where t.id = trip_itineraries.trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

-- Any trip member can request/regenerate the plan (upsert on trip_id).
drop policy if exists "trip_itineraries_insert" on public.trip_itineraries;
create policy "trip_itineraries_insert" on public.trip_itineraries
  for insert with check (
    requested_by = auth.uid()
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_itineraries_update" on public.trip_itineraries;
create policy "trip_itineraries_update" on public.trip_itineraries
  for update using (
    exists (
      select 1 from public.trips t
      where t.id = trip_itineraries.trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

drop policy if exists "trip_itineraries_delete" on public.trip_itineraries;
create policy "trip_itineraries_delete" on public.trip_itineraries
  for delete using (
    exists (
      select 1 from public.trips t
      where t.id = trip_itineraries.trip_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.trip_invites ti
            where ti.trip_id = t.id and ti.email = auth.jwt() ->> 'email'
          )
        )
    )
  );

-- ============================================================
-- Functions + triggers
-- ============================================================

-- Mirrors the public bits of auth.users (which clients can't query
-- directly) into public.profiles automatically, so no app code has to
-- remember to dual-write when a user's name/photo changes.
create or replace function public.handle_new_or_updated_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, updated_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_or_updated_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute procedure public.handle_new_or_updated_user();

-- Safe dequeue for the video-extraction worker: atomically claims the
-- oldest pending row so two worker instances (or two lanes of the same
-- one) can never grab the same job. `returns setof` + `returning *` is
-- what makes "zero pending jobs" come back as zero rows rather than one
-- row of nulls -- security definer so it can update rows the caller's own
-- RLS wouldn't otherwise let it touch.
drop function if exists public.claim_next_clip_job();
create function public.claim_next_clip_job()
returns setof public.trip_clips
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  update public.trip_clips
  set status = 'processing', processing_started_at = now()
  where id = (
    select id from public.trip_clips
    where status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;

-- security definer functions are otherwise callable by any authenticated
-- client by default -- without this, any signed-in user could call this
-- RPC and claim/steal jobs themselves. Only the worker (service-role key,
-- which ignores these grants entirely) should call it.
revoke execute on function public.claim_next_clip_job() from public, anon, authenticated;
grant execute on function public.claim_next_clip_job() to service_role;

-- Same safe-dequeue pattern as claim_next_clip_job(), for the itinerary
-- generation queue.
create or replace function public.claim_next_itinerary_job()
returns setof public.trip_itineraries
language plpgsql
security definer set search_path = public
as $$
declare
  claimed public.trip_itineraries;
begin
  update public.trip_itineraries
  set status = 'processing', processing_started_at = now()
  where id = (
    select id from public.trip_itineraries
    where status = 'pending'
    order by created_at
    limit 1
    for update skip locked
  )
  returning * into claimed;

  if claimed.id is null then
    return;
  end if;

  return next claimed;
end;
$$;

revoke execute on function public.claim_next_itinerary_job() from public, anon, authenticated;
grant execute on function public.claim_next_itinerary_job() to service_role;

-- Backs the "any trip member can edit name/dates, only the owner can edit
-- anything else" rule: the update policy above lets any member's UPDATE
-- through at the row level, and this trigger is what actually rejects it
-- if a non-owner's statement changed any column other than
-- name/start_date/end_date.
create or replace function public.enforce_trip_member_edit_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.owner_id <> auth.uid() then
    if new.owner_id is distinct from old.owner_id
      or new.destination is distinct from old.destination
      or new.party_size is distinct from old.party_size
      or new.description is distinct from old.description
      or new.lat is distinct from old.lat
      or new.lng is distinct from old.lng
      or new.cover_photo_url is distinct from old.cover_photo_url
      or new.home_base_label is distinct from old.home_base_label
      or new.home_base_lat is distinct from old.home_base_lat
      or new.home_base_lng is distinct from old.home_base_lng
    then
      raise exception 'Only the trip owner can change that.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_enforce_member_edit_columns on public.trips;
create trigger trips_enforce_member_edit_columns
  before update on public.trips
  for each row execute function public.enforce_trip_member_edit_columns();

-- ============================================================
-- Storage buckets
-- ============================================================

-- Profile photos: one file per user, named "<user id>.jpg" so a re-upload
-- (upsert) always replaces the same object instead of leaving orphans.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_public_read" on storage.objects;
create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar_owner_insert" on storage.objects;
create policy "avatar_owner_insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

drop policy if exists "avatar_owner_update" on storage.objects;
create policy "avatar_owner_update" on storage.objects
  for update using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

-- Trip cover photos: one file per trip ("<trip id>.jpg"), ownership
-- checked via a trips subquery -- the object name encodes a trip id, not a
-- user id, and must be qualified as storage.objects.name (trips also has
-- its own `name` column, so the bare identifier is ambiguous otherwise).
insert into storage.buckets (id, name, public)
values ('trip-covers', 'trip-covers', true)
on conflict (id) do nothing;

drop policy if exists "trip_cover_public_read" on storage.objects;
create policy "trip_cover_public_read" on storage.objects
  for select using (bucket_id = 'trip-covers');

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

-- One representative thumbnail per processed clip. Only the worker
-- (service role, bypasses RLS) ever writes these -- no client-facing write
-- path, so no insert/update policy is needed (Postgres denies by default).
insert into storage.buckets (id, name, public)
values ('clip-thumbnails', 'clip-thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "clip_thumbnail_public_read" on storage.objects;
create policy "clip_thumbnail_public_read" on storage.objects
  for select using (bucket_id = 'clip-thumbnails');

-- ============================================================
-- Realtime publication membership
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_clips'
  ) then
    alter publication supabase_realtime add table public.trip_clips;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clip_places'
  ) then
    alter publication supabase_realtime add table public.clip_places;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clip_place_votes'
  ) then
    alter publication supabase_realtime add table public.clip_place_votes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_itineraries'
  ) then
    alter publication supabase_realtime add table public.trip_itineraries;
  end if;
end $$;

-- ============================================================
-- One-time data backfills
-- ============================================================

-- Accounts that existed before public.profiles did (their next sign-in/
-- profile edit would sync them anyway, but no need to wait).
insert into public.profiles (id, email, full_name, avatar_url, updated_at)
select id, email, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'avatar_url', now()
from auth.users
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  avatar_url = excluded.avatar_url,
  updated_at = now();

-- Clips processed under the old single-location model (before clip_places
-- existed) get a matching clip_places row instead of just losing their
-- pin. Guarded by "not already backfilled" so re-running this doesn't
-- create duplicate places for the same clip.
insert into public.clip_places (clip_id, name, location_name, lat, lng, rank)
select c.id, coalesce(c.location_name, c.title, 'Location'), c.location_name, c.lat, c.lng, 0
from public.trip_clips c
where c.lat is not null
  and c.lng is not null
  and not exists (select 1 from public.clip_places p where p.clip_id = c.id);

-- Force PostgREST to pick up any schema changes from this run immediately
-- instead of waiting for its own change-detection.
notify pgrst, 'reload schema';
