-- Previously only whoever shared a clip (or the trip owner) could delete
-- it. Now any trip member can delete any clip -- the delete button lives
-- directly on the clip's card in the Blend tab, not gated behind opening
-- it, so the RLS policy needs to match: same trip-membership check used
-- throughout (trip_stops, trip_itineraries, etc.) rather than a
-- sharer-only check.
drop policy if exists "trip_clips_delete" on public.trip_clips;
create policy "trip_clips_delete" on public.trip_clips
  for delete using (
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
