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

## 3. Enable RLS, policy, and grants (basic MVP)
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

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.farm_profiles to anon, authenticated;
grant select, insert, update, delete on table public.task_history to anon, authenticated;
grant usage, select on sequence public.task_history_id_seq to anon, authenticated;
```

Important: this is fine for demo/MVP only.

## 4. Turn on email auth
1. Supabase -> `Authentication` -> `Providers` -> `Email`
2. Keep `Email` enabled
3. For production, configure your own SMTP later

## 5. Add URL and keys in app
1. Supabase -> `Project Settings` -> `API`
2. Copy:
   - `Project URL`
   - `publishable` (or `anon public`) key
3. Put them in `app-config.js`:

```js
window.APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY"
};
```

## 6. Configure redirect URL for login link
1. Supabase -> `Authentication` -> `URL Configuration`
2. Add your site URL, for example:
   - `https://pivaniva.github.io`
   - `https://pivaniva.github.io/smart-farm-advisor/`

## 7. Push and test
```bash
git add .
git commit -m "Enable Supabase cloud sync"
git push
```

After deploy, dashboard should show `ქლაუდი (Supabase)` as data source.

For login test:
1. Enter email in app
2. Open magic link from email
3. Return to app and confirm status shows logged-in email
