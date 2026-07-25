-- Fixes "infinite recursion detected in policy for relation trips":
-- trip_invites_select was querying public.trips, whose own select policy
-- queries public.trip_invites, forming a cycle. Not needed anyway — in
-- this app invited_by is always the trip owner.

drop policy if exists "trip_invites_select" on public.trip_invites;

create policy "trip_invites_select" on public.trip_invites
  for select using (
    invited_by = auth.uid()
    or email = auth.jwt() ->> 'email'
  );
