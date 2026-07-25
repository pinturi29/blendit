-- "Blend" shared clips + consensus votes. Clip content (title/description)
-- is entered manually — no automatic TikTok/Instagram extraction.

create table if not exists public.trip_clips (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  shared_by uuid not null references auth.users (id) on delete cascade,
  source text not null default 'TikTok' check (source in ('TikTok', 'Instagram Reels')),
  url text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_clip_votes (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.trip_clips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

alter table public.trip_clips enable row level security;
alter table public.trip_clip_votes enable row level security;

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

create policy "trip_clips_delete" on public.trip_clips
  for delete using (
    shared_by = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_clips.trip_id and t.owner_id = auth.uid()
    )
  );

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

create policy "trip_clip_votes_update_own" on public.trip_clip_votes
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "trip_clip_votes_delete_own" on public.trip_clip_votes
  for delete using (user_id = auth.uid());
