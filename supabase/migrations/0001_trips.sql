-- Trips + invites, with row-level security so:
--   * a trip is visible to its owner and to anyone invited by email
--   * only the owner can create/edit/delete a trip or invite people to it

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

-- Note: this intentionally does NOT also check "is the current user the
-- trip's owner" via a subquery on public.trips — trips' own select policy
-- queries trip_invites, and that combination causes Postgres to report
-- "infinite recursion detected in policy for relation trips". It's not
-- needed anyway: in this app invited_by is always the trip owner (see
-- createTripWithInvites), so invited_by = auth.uid() already covers it.
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
