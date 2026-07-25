-- Safe to run any number of times: drops each policy if it exists, then
-- recreates all of them with the recursion fix applied. Tables are left
-- untouched (create table if not exists is a no-op if they're already there).

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  destination text not null,
  start_date date not null,
  end_date date not null,
  party_size integer not null default 1,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  email text not null,
  status text not null default 'invited' check (status in ('invited', 'joined')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.trips enable row level security;
alter table public.trip_invites enable row level security;

drop policy if exists "trips_select_own_or_invited" on public.trips;
drop policy if exists "trips_insert_own" on public.trips;
drop policy if exists "trips_update_own" on public.trips;
drop policy if exists "trips_delete_own" on public.trips;
drop policy if exists "trip_invites_select" on public.trip_invites;
drop policy if exists "trip_invites_insert_owner" on public.trip_invites;

create policy "trips_select_own_or_invited" on public.trips
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trip_invites ti
      where ti.trip_id = trips.id and ti.email = auth.jwt() ->> 'email'
    )
  );

create policy "trips_insert_own" on public.trips
  for insert with check (owner_id = auth.uid());

create policy "trips_update_own" on public.trips
  for update using (owner_id = auth.uid());

create policy "trips_delete_own" on public.trips
  for delete using (owner_id = auth.uid());

-- Does NOT query public.trips (that would recreate the recursion with
-- trips_select_own_or_invited above). Not needed anyway — in this app
-- invited_by is always the trip owner.
create policy "trip_invites_select" on public.trip_invites
  for select using (
    invited_by = auth.uid()
    or email = auth.jwt() ->> 'email'
  );

create policy "trip_invites_insert_owner" on public.trip_invites
  for insert with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.owner_id = auth.uid()
    )
  );
