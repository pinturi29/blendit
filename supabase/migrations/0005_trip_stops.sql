-- Extra locations attached to a trip (beyond its main destination), added
-- from the trip detail screen. Doesn't touch trips.destination — the
-- home screen's trip title is unaffected.

create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  label text not null,
  lat double precision,
  lng double precision,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.trip_stops enable row level security;

-- Visible to anyone who can already see the parent trip (owner or invited).
-- References public.trips (safe: trips -> trip_invites is the only cycle,
-- and trip_stops isn't part of it).
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
create policy "trip_stops_delete" on public.trip_stops
  for delete using (
    created_by = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_stops.trip_id and t.owner_id = auth.uid()
    )
  );
