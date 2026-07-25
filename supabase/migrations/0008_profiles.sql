-- Public profile info (name + avatar), so trip-mates can see who invited
-- them, who else is on a trip, and who shared a clip. auth.users itself
-- isn't queryable by clients, so this mirrors just the public bits of it,
-- kept in sync automatically by triggers -- no app code has to remember to
-- dual-write when it updates a user's name/photo.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

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

-- Backfill accounts that already existed before this migration (their next
-- sign-in/profile edit would sync them anyway, but no need to wait).
insert into public.profiles (id, email, full_name, avatar_url, updated_at)
select id, email, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'avatar_url', now()
from auth.users
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  avatar_url = excluded.avatar_url,
  updated_at = now();

-- Visible to yourself, or to anyone who shares a trip with you (same
-- "owner or invited" membership test already used by trip_stops/trip_clips
-- in earlier migrations). Doesn't get queried back by trips/trip_invites'
-- own policies, so no recursion risk.
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
