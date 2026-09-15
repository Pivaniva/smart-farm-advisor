-- PlantCare pivot — Phase 2 data model.
-- Adds multi-plant support (farm_profiles is one row per device_id and
-- can't hold more than one crop/plant, so this is a new table rather
-- than an ALTER of farm_profiles, which is left untouched).
--
-- Confirmed via pg_policies: farm_profiles and task_history both already
-- enforce `auth.uid() = user_id` for ALL commands, role public. The app
-- never wrote user_id, so every cloud write from a logged-in session has
-- been silently rejected by RLS since that policy went live — cloud sync
-- has effectively been dead for months and everything has been living in
-- localStorage. user_plants gets the identical policy, plus a DB-level
-- default so user_id is populated automatically without the client
-- having to set it.

-- ── user_plants ──────────────────────────────────────────────────────────
create table if not exists user_plants (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  user_id uuid null,
  catalog_id text not null,
  nickname text,
  location text,
  window_direction text,
  pot_size_cm int,
  last_watered date,
  last_fertilized date,
  last_repotted date,
  photo_url text,
  added_at timestamptz not null default now()
);

create index if not exists idx_user_plants_device_id on user_plants (device_id);
create index if not exists idx_user_plants_user_id on user_plants (user_id);

alter table user_plants enable row level security;

create policy "user_plants: owner access"
  on user_plants
  for all
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-populate user_id from the session on insert so the client never
-- has to (and can't forget to) set it — same fix applied to the two
-- existing tables so future inserts there stop silently failing RLS too.
alter table user_plants alter column user_id set default auth.uid();
alter table farm_profiles alter column user_id set default auth.uid();
alter table task_history alter column user_id set default auth.uid();

-- ── task_history: link care actions to a plant ──────────────────────────
-- Existing rows are untouched — plant_id is nullable so old farm task
-- history (watering/spraying/inspection logged against a device, not a
-- specific plant) stays valid as-is.
alter table task_history
  add column if not exists plant_id uuid null references user_plants (id) on delete set null;

create index if not exists idx_task_history_plant_id on task_history (plant_id);
