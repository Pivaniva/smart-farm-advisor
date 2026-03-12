# Supabase Setup (Free Plan)

This app already works in local mode.  
To make it a real cloud app, follow steps below.

## 1. Create Supabase project
1. Go to `https://supabase.com`
2. Create account and new project (free)
3. Wait until DB is ready

## 2. Create tables
Open `SQL Editor` and run:

```sql
create table if not exists public.farm_profiles (
  device_id text primary key,
  crop text not null,
  location text not null,
  planting_date date not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.task_history (
  id bigint generated always as identity primary key,
  device_id text not null,
  task_key text not null,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists task_history_device_id_created_at_idx
on public.task_history (device_id, created_at desc);
```

## 3. Enable RLS and policy (basic MVP)
Run:

```sql
alter table public.farm_profiles enable row level security;
alter table public.task_history enable row level security;

create policy "mvp_allow_all_profiles"
on public.farm_profiles
for all
using (true)
with check (true);

create policy "mvp_allow_all_tasks"
on public.task_history
for all
using (true)
with check (true);
```

Important: this is fine for demo/MVP only.

## 4. Add project keys in app
1. Supabase -> `Project Settings` -> `API`
2. Copy:
   - `Project URL`
   - `anon public` key
3. Put them in `app-config.js`:

```js
window.APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY"
};
```

## 5. Push and test
```bash
git add .
git commit -m "Enable Supabase cloud sync"
git push
```

After deploy, dashboard should show `ქლაუდი (Supabase)` as data source.

