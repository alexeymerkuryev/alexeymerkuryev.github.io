-- ShotDays initial Supabase schema
-- Apply this file in Supabase SQL Editor after creating a project.
-- IDs are TEXT to preserve existing IndexedDB identifiers during migration.

create table if not exists public.activities (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  type text not null check (type in ('counter', 'habit', 'event')),
  unit text,
  color text,
  icon text,
  input_mode text not null default 'both'
    check (input_mode in ('manual', 'quick', 'both')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.activity_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null,
  entry_date date not null,
  value numeric,
  status text check (status in ('completed', 'missed', 'success', 'slipped')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_entries_activity_owner_fk
    foreign key (activity_id, user_id)
    references public.activities (id, user_id) on delete cascade,
  constraint activity_entries_value_nonnegative
    check (value is null or value >= 0)
);

create index if not exists activities_user_created_idx
  on public.activities (user_id, created_at);

create index if not exists activity_entries_user_date_idx
  on public.activity_entries (user_id, entry_date);

create index if not exists activity_entries_activity_date_idx
  on public.activity_entries (activity_id, entry_date);

alter table public.activities enable row level security;
alter table public.activity_entries enable row level security;

drop policy if exists "Users can read their own activities" on public.activities;
create policy "Users can read their own activities"
  on public.activities for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own activities" on public.activities;
create policy "Users can insert their own activities"
  on public.activities for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own activities" on public.activities;
create policy "Users can update their own activities"
  on public.activities for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own activities" on public.activities;
create policy "Users can delete their own activities"
  on public.activities for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can read their own entries" on public.activity_entries;
create policy "Users can read their own entries"
  on public.activity_entries for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own entries" on public.activity_entries;
create policy "Users can insert their own entries"
  on public.activity_entries for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.activities a
      where a.id = activity_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their own entries" on public.activity_entries;
create policy "Users can update their own entries"
  on public.activity_entries for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.activities a
      where a.id = activity_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can delete their own entries" on public.activity_entries;
create policy "Users can delete their own entries"
  on public.activity_entries for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.activities to authenticated;
grant select, insert, update, delete on public.activity_entries to authenticated;
