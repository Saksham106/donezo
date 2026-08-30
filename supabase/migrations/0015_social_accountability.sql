-- Social accountability loops: challenges, recoveries, and opt-in non-money stakes.

create table if not exists public.weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('completion_percent', 'total_completions', 'no_consecutive_miss')),
  title text not null check (char_length(title) between 1 and 80),
  target integer not null check (target between 1 and 10000),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on and ends_on <= starts_on + 13),
  status text not null default 'active' check (status in ('active', 'completed', 'failed', 'cancelled')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (circle_id, starts_on)
);

create index if not exists weekly_challenges_circle_period_idx
  on public.weekly_challenges(circle_id, starts_on desc);

create table if not exists public.challenge_participants (
  challenge_id uuid not null references public.weekly_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  opted_out_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table if not exists public.habit_recoveries (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  missed_date date not null,
  recovered_at timestamptz,
  action text not null check (action in ('recover_today', 'adjust_habit', 'pause_habit', 'ask_support')),
  reflection text check (reflection is null or char_length(reflection) <= 280),
  visibility text not null default 'private' check (visibility in ('private', 'squad')),
  created_at timestamptz not null default now(),
  unique (habit_id, user_id, missed_date)
);

create index if not exists habit_recoveries_user_created_idx
  on public.habit_recoveries(user_id, created_at desc);

create table if not exists public.group_stakes (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  challenge_id uuid references public.weekly_challenges(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  rule text not null check (rule in ('winner', 'loser', 'all_succeed')),
  reward text check (reward is null or char_length(reward) <= 140),
  consequence text check (consequence is null or char_length(consequence) <= 140),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  status text not null default 'pending' check (status in ('pending', 'active', 'resolved', 'declined', 'cancelled')),
  resolution jsonb,
  activated_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (coalesce(char_length(trim(reward)), 0) > 0 or coalesce(char_length(trim(consequence)), 0) > 0),
  check (coalesce(reward, '') !~* '([$€£¥₹]|\m(cash|money|bet|wager|venmo|paypal|dollars?|euros?|pounds?)\M)'),
  check (coalesce(consequence, '') !~* '([$€£¥₹]|\m(cash|money|bet|wager|venmo|paypal|dollars?|euros?|pounds?)\M)')
);

create index if not exists group_stakes_circle_period_idx
  on public.group_stakes(circle_id, starts_on desc);

create table if not exists public.stake_consents (
  stake_id uuid not null references public.group_stakes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  primary key (stake_id, user_id)
);

create or replace function private.lock_active_stake_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active', 'resolved') and (
    new.rule is distinct from old.rule
    or new.reward is distinct from old.reward
    or new.consequence is distinct from old.consequence
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.circle_id is distinct from old.circle_id
  ) then
    raise exception 'Active stake rules are locked';
  end if;
  if old.status = 'pending' and new.status = 'active' and not exists (
    select 1
    from public.circle_members member
    where member.circle_id = old.circle_id
      and not exists (
        select 1
        from public.stake_consents consent
        where consent.stake_id = old.id
          and consent.user_id = member.user_id
          and consent.status = 'accepted'
      )
  ) then
    raise exception 'Every participant must accept before activation';
  end if;
  if new.status = 'resolved' and old.status <> 'active' then
    raise exception 'Only an active stake can be resolved';
  end if;
  if new.resolution is not null and new.status <> 'resolved' then
    raise exception 'Resolution is only valid for resolved stakes';
  end if;
  return new;
end;
$$;

revoke all on function private.lock_active_stake_rules() from public, anon, authenticated;

drop trigger if exists lock_active_stake_rules on public.group_stakes;
create trigger lock_active_stake_rules
  before update on public.group_stakes
  for each row execute function private.lock_active_stake_rules();

create or replace function public.respond_to_stake(target_stake uuid, response text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_circle uuid;
  participant_count integer;
  accepted_count integer;
begin
  if response not in ('accepted', 'declined') then raise exception 'Invalid response'; end if;
  select circle_id into target_circle from public.group_stakes where id = target_stake and status = 'pending' for update;
  if target_circle is null then raise exception 'Stake is not open'; end if;
  if not exists (select 1 from public.circle_members where circle_id = target_circle and user_id = actor) then
    raise exception 'Not a participant';
  end if;
  insert into public.stake_consents(stake_id, user_id, status, responded_at)
  values (target_stake, actor, response, now())
  on conflict (stake_id, user_id) do update set status = excluded.status, responded_at = excluded.responded_at;
  if response = 'declined' then
    update public.group_stakes set status = 'declined' where id = target_stake;
    return false;
  end if;
  select count(*) into participant_count from public.circle_members where circle_id = target_circle;
  select count(*) into accepted_count from public.stake_consents where stake_id = target_stake and status = 'accepted';
  if participant_count > 0 and accepted_count = participant_count then
    update public.group_stakes set status = 'active', activated_at = now() where id = target_stake;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.respond_to_stake(uuid, text) from public, anon;
grant execute on function public.respond_to_stake(uuid, text) to authenticated;

alter table public.weekly_challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.habit_recoveries enable row level security;
alter table public.group_stakes enable row level security;
alter table public.stake_consents enable row level security;

revoke all on public.weekly_challenges, public.challenge_participants, public.habit_recoveries, public.group_stakes, public.stake_consents from anon, authenticated;
grant select, insert, update on public.weekly_challenges to authenticated;
grant select, insert, update, delete on public.challenge_participants to authenticated;
grant select, insert, update on public.habit_recoveries to authenticated;
grant select, insert, update on public.group_stakes to authenticated;
grant select on public.stake_consents to authenticated;

create policy weekly_challenges_select_members on public.weekly_challenges for select to authenticated
using (circle_id in (select private.user_circle_ids()));
create policy weekly_challenges_insert_members on public.weekly_challenges for insert to authenticated
with check (created_by = (select auth.uid()) and circle_id in (select private.user_circle_ids()));
create policy weekly_challenges_update_creator on public.weekly_challenges for update to authenticated
using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy challenge_participants_select_members on public.challenge_participants for select to authenticated
using (exists (select 1 from public.weekly_challenges c where c.id = challenge_id and c.circle_id in (select private.user_circle_ids())));
create policy challenge_participants_insert_self_or_creator on public.challenge_participants for insert to authenticated
with check (user_id = (select auth.uid()) or exists (select 1 from public.weekly_challenges c where c.id = challenge_id and c.created_by = (select auth.uid())));
create policy challenge_participants_update_self on public.challenge_participants for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy challenge_participants_delete_self on public.challenge_participants for delete to authenticated
using (user_id = (select auth.uid()));

create policy habit_recoveries_select_visible on public.habit_recoveries for select to authenticated
using (user_id = (select auth.uid()) or (visibility = 'squad' and private.habit_visible_to_current_user(habit_id)));
create policy habit_recoveries_insert_self on public.habit_recoveries for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.habits h where h.id = habit_id and h.owner_id = (select auth.uid())));
create policy habit_recoveries_update_self on public.habit_recoveries for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy group_stakes_select_members on public.group_stakes for select to authenticated
using (circle_id in (select private.user_circle_ids()));
create policy group_stakes_insert_members on public.group_stakes for insert to authenticated
with check (created_by = (select auth.uid()) and circle_id in (select private.user_circle_ids()) and status = 'pending');
create policy group_stakes_update_creator on public.group_stakes for update to authenticated
using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy stake_consents_select_participants on public.stake_consents for select to authenticated
using (exists (select 1 from public.group_stakes s where s.id = stake_id and s.circle_id in (select private.user_circle_ids())));
