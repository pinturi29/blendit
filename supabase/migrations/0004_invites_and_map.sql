-- Adds coordinates for the map view, and the RLS policies needed for
-- invite accept/reject and owner member-removal.

alter table public.trips add column if not exists lat double precision;
alter table public.trips add column if not exists lng double precision;

-- An invited person can update their own invite row (used to accept: sets
-- status to 'joined'). Does not reference public.trips, so no recursion.
drop policy if exists "trip_invites_update_self" on public.trip_invites;
create policy "trip_invites_update_self" on public.trip_invites
  for update using (email = auth.jwt() ->> 'email')
  with check (email = auth.jwt() ->> 'email');

-- Either the trip owner (who is always invited_by, since only owners
-- create invites in this app) or the invited person themself can delete
-- an invite row — covers both "owner removes a member" and "I reject an
-- invite". Does not reference public.trips, so no recursion.
drop policy if exists "trip_invites_deletce" on public.trip_invites;
create policy "trip_invites_delete" on public.trip_invites
  for delete using (
    invited_by = auth.uid()
    or email = auth.jwt() ->> 'email'
  );
