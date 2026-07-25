# blendit

A group trip-planning app: plan a trip with friends, invite them by email, and let everyone vote on ideas — TikToks and Reels shared into the trip — until a plan the whole group actually agreed on falls out of it.

Built with Expo (React Native) and Supabase (Postgres + Auth + Storage), matched pixel-for-pixel to the design mockup in [`design/blendit-app-design.html`](design/blendit-app-design.html).

## Features

- **Email + password auth** (Supabase Auth), with an editable display name and profile photo.
- **Trips** — destination (with map-autocomplete search), dates, party size, description, an optional custom trip name, and an optional cover photo.
- **Invites by email** — invite people before they've even signed up; the trip shows up the moment they log in with that email. No invite links to send around.
- **Blend** — the core loop: paste a TikTok or Instagram Reels link to a trip, and everyone in the group votes it up or down. A consensus meter shows one segment per person.
- **Itinerary** — clips with more up-votes than down automatically surface here, so the plan is built from what the group actually agreed on.
- **Trip stops** — extra pinned locations beyond the main destination.
- **Map** — every trip you're in, pinned on a map (Leaflet via WebView, no API key needed); tap a pin or chip to focus a trip.
- **Profile** — editable name and photo (with a native crop/zoom step), plus stats: trips, clips shared, archived trips, reels sent.

## Tech stack

- **Expo** (SDK 54) / React Native 0.81 / TypeScript (strict)
- **React Navigation** (native-stack) for routing
- **Supabase** — Postgres with row-level security, Auth, and Storage (avatars + trip cover photos)
- **react-native-webview** + Leaflet (via CARTO tiles) for the map — no Google/Mapbox API key required
- Place search via OpenStreetMap's Nominatim API
- Fonts: Inter (UI) + Instrument Serif (the "blendit" wordmark), via `@expo-google-fonts`

## Project structure

```
App.tsx                    Entry point — loads fonts, wraps app in Auth/Navigation providers
src/
  navigation/               Root stack navigator + route param types
  context/AuthContext.tsx   Supabase session state, sign in/up/out
  screens/                  One file per screen (see below)
  components/               Shared UI primitives (Button, TextField, Avatar, Chip, ...)
  lib/                      Data layer — typed functions that call Supabase directly
  theme/tokens.ts           Colors, fonts, spacing, radii — lifted from the design mockup
design/
  blendit-app-design.html   Static HTML mockup this app is built to match
supabase/
  migrations/               SQL migrations, applied in order (see below)
```

### Screens

| Screen | Purpose |
|---|---|
| `WelcomeScreen` | Interstitial shown once per sign-in before entering the app |
| `LoginScreen` / `SignUpScreen` | Auth |
| `TabsScreen` | Hosts Home + Map with the bottom nav and create-trip FAB |
| `HomeScreen` | Trip list, filters (All/Archived/Invites), pending-vote prompt |
| `MapScreen` | All your trips on a map |
| `CreateTripScreen` | Two-step trip creation: basics (destination, name, cover photo, dates, party size) → invite the group |
| `TripDetailScreen` | Trip management: cover photo, name, stops, members, delete (owner-only actions gated behind trip ownership) |
| `TripViewScreen` | Blend (shared clips + voting) and Itinerary tabs |
| `ProfileScreen` | Your name, photo, and stats |

### Data layer (`src/lib/`)

Each file wraps a set of related Supabase queries — no ORM, no separate backend; the client talks to Supabase directly and row-level security enforces who can see/change what.

- `trips.ts` — trips, invites, stops, `tripDisplayName()` helper
- `clips.ts` — shared clips + votes, including the "pending votes" queries that drive Home's unlock prompt
- `profile.ts` — your own display name/avatar, plus batched lookups (`getProfilesByIds`/`getProfilesByEmails`) for other users' public profile info
- `tripCover.ts` — pick/upload a trip's cover photo
- `mapHtml.ts` — builds the self-contained Leaflet HTML page for the map WebView
- `errors.ts` — `getErrorMessage()` helper for consistent error surfacing

## Getting started

### Prerequisites

- Node.js and npm
- A [Supabase](https://supabase.com) project
- Expo Go (or an iOS/Android simulator) for running the app

### 1. Install dependencies

```
npm install
```

### 2. Configure environment

```
cp .env.example .env
```

Fill in your Supabase project's URL and anon key:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Set up the database

Run every file in `supabase/migrations/` **in order** against your Supabase project (via the SQL Editor in the Supabase dashboard, or the Supabase CLI if you have it linked). There's no automated migration runner wired up yet — this is a manual, one-time-per-environment step.

| Migration | What it does |
|---|---|
| `0001_trips.sql` | `trips` + `trip_invites` tables and their RLS policies |
| `0002_fix_trip_invites_recursion.sql` | Fixes an RLS recursion bug from 0001 |
| `0003_reset_trip_policies.sql` | Idempotent reset/consolidation of the trips policies |
| `0004_invites_and_map.sql` | Adds `lat`/`lng` to trips; invite accept/reject/remove policies |
| `0005_trip_stops.sql` | `trip_stops` table (extra pinned locations per trip) |
| `0006_clips_and_votes.sql` | `trip_clips` + `trip_clip_votes` tables (the Blend feature) |
| `0007_avatar_storage.sql` | `avatars` Storage bucket + RLS for profile photos |
| `0008_profiles.sql` | Public `profiles` table (mirrors `auth.users`) so trip-mates can see each other's name/photo |
| `0009_trip_name_and_cover.sql` | Adds `trips.name` + `trips.cover_photo_url`, and the `trip-covers` Storage bucket |
| `0010_fix_trip_cover_rls.sql` | Fixes an RLS bug in 0009's cover-photo storage policies |

### 4. Run the app

```
npm start        # then press i / a / w, or scan the QR code with Expo Go
npm run ios
npm run android
npm run web
```

## Notable design decisions

- **No custom backend** — the client talks to Supabase directly; row-level security is the only authorization layer. Every table's RLS policy is commented in its migration file explaining what it allows and why.
- **Invite-by-email, not invite links** — `trip_invites` rows are created by email before the invited person necessarily has an account; the trip becomes visible to them as soon as they sign in with that email.
- **Public `profiles` table** — `auth.users` isn't queryable by clients, so a `profiles` table is kept in sync via database triggers (on insert/update of `auth.users`) and is readable by anyone who shares a trip with that person — not publicly by everyone.
- **Photos** are picked via `expo-image-picker` with native crop/zoom (square for avatars, 4:3 for trip covers) and uploaded to per-user/per-trip paths in Supabase Storage with `upsert`, so re-uploads replace rather than accumulate.
