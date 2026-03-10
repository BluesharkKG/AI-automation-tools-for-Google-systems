-- Run in Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('user','admin')) default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.user_stamp_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stamp_count integer not null default 0 check (stamp_count between 0 and 15),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_milestones (
  milestone_stamp integer primary key,
  reward_name text not null,
  is_active boolean not null default true
);

insert into public.reward_milestones (milestone_stamp, reward_name)
values
  (1, 'BOGO reward'),
  (5, '25% off any map'),
  (8, '15% off any map'),
  (10, '50% off any map'),
  (12, '75% off any map'),
  (15, 'BOGO reward')
on conflict (milestone_stamp) do update set reward_name = excluded.reward_name;

create table if not exists public.user_rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_stamp integer not null references public.reward_milestones(milestone_stamp),
  reward_name text not null,
  unlocked_at timestamptz,
  redeemed_at timestamptz,
  unique (user_id, milestone_stamp)
);

alter table public.user_profiles enable row level security;
alter table public.user_stamp_progress enable row level security;
alter table public.user_rewards enable row level security;
alter table public.reward_milestones enable row level security;

create policy "users_read_own_profile" on public.user_profiles
for select using (auth.uid() = id);

create policy "users_read_own_stamps" on public.user_stamp_progress
for select using (auth.uid() = user_id);

create policy "users_read_own_rewards" on public.user_rewards
for select using (auth.uid() = user_id);

create policy "users_read_active_milestones" on public.reward_milestones
for select using (is_active = true);

create or replace view public.user_stamp_overview as
select
  p.id as user_id,
  p.username,
  sp.stamp_count,
  (select min(m.milestone_stamp) from public.reward_milestones m where m.milestone_stamp > sp.stamp_count and m.is_active = true) as next_milestone
from public.user_profiles p
join public.user_stamp_progress sp on sp.user_id = p.id
where p.id = auth.uid();

create or replace view public.user_reward_status as
select
  m.milestone_stamp,
  m.reward_name,
  ur.unlocked_at,
  ur.redeemed_at
from public.reward_milestones m
left join public.user_rewards ur
  on ur.milestone_stamp = m.milestone_stamp
 and ur.user_id = auth.uid()
where m.is_active = true;

grant select on public.user_stamp_overview to authenticated;
grant select on public.user_reward_status to authenticated;
