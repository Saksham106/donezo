-- Schedule engine foundation.
-- Existing habits remain daily by default; schedule versions make future edits
-- append-only and keep the rules used by historical check-ins queryable.

alter table public.habits
  add column if not exists schedule_frequency text not null default 'daily',
  add column if not exists schedule_weekdays smallint[] not null default '{}',
  add column if not exists target_quantity numeric not null default 1,
  add column if not exists target_unit text not null default 'count',
  add column if not exists due_time time,
  add column if not exists grace_minutes integer not null default 0,
  add column if not exists schedule_timezone text not null default 'America/New_York';

update public.habits h
set schedule_frequency = case
      when h.frequency = 'daily' then 'daily'
      else 'daily'
    end,
    due_time = h.target_time,
    schedule_timezone = coalesce(
      (select p.timezone from public.profiles p where p.id = h.owner_id),
      'America/New_York'
    )
where h.schedule_frequency = 'daily'
  and h.target_quantity = 1
  and h.target_unit = 'count'
  and h.due_time is null;

alter table public.habits drop constraint if exists habits_schedule_frequency_check;
alter table public.habits add constraint habits_schedule_frequency_check
  check (schedule_frequency in ('daily', 'selected_weekdays', 'weekly'));
alter table public.habits drop constraint if exists habits_schedule_weekdays_check;
alter table public.habits add constraint habits_schedule_weekdays_check
  check (
    schedule_weekdays is not null
    and cardinality(schedule_weekdays) <= 7
    and schedule_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and (schedule_frequency <> 'selected_weekdays' or cardinality(schedule_weekdays) > 0)
  );
alter table public.habits drop constraint if exists habits_target_quantity_check;
alter table public.habits add constraint habits_target_quantity_check check (target_quantity > 0);
alter table public.habits drop constraint if exists habits_target_unit_check;
alter table public.habits add constraint habits_target_unit_check
  check (char_length(trim(target_unit)) between 1 and 40);
alter table public.habits drop constraint if exists habits_grace_minutes_check;
alter table public.habits add constraint habits_grace_minutes_check
  check (grace_minutes between 0 and 10080);

create index if not exists habits_schedule_lookup_idx
  on public.habits(owner_id, active, schedule_timezone, schedule_frequency);

-- The pre-schedule RPCs still write target_time. Keep their daily writes
-- readable by the schedule engine until clients migrate to the schedule RPC.
create or replace function private.sync_legacy_habit_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.due_time is null and new.target_time is not null then
    new.due_time := new.target_time;
  elsif tg_op = 'UPDATE'
    and new.target_time is distinct from old.target_time
    and new.schedule_frequency = 'daily'
    and new.target_quantity = 1
    and new.target_unit = 'count' then
    new.due_time := new.target_time;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_legacy_habit_schedule() from public, anon, authenticated;
drop trigger if exists sync_legacy_habit_schedule_columns on public.habits;
create trigger sync_legacy_habit_schedule_columns
before insert or update on public.habits
for each row execute function private.sync_legacy_habit_schedule();

create table if not exists public.habit_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  version integer not null check (version > 0),
  effective_from date not null,
  effective_until date,
  schedule_frequency text not null default 'daily'
    check (schedule_frequency in ('daily', 'selected_weekdays', 'weekly')),
  schedule_weekdays smallint[] not null default '{}',
  target_quantity numeric not null default 1 check (target_quantity > 0),
  target_unit text not null default 'count'
    check (char_length(trim(target_unit)) between 1 and 40),
  due_time time,
  grace_minutes integer not null default 0
    check (grace_minutes between 0 and 10080),
  timezone text not null default 'America/New_York',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (habit_id, version),
  check (effective_until is null or effective_until > effective_from),
  check (
    cardinality(schedule_weekdays) <= 7
    and schedule_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and (schedule_frequency <> 'selected_weekdays' or cardinality(schedule_weekdays) > 0)
  )
);

create index if not exists habit_schedule_versions_date_idx
  on public.habit_schedule_versions(habit_id, effective_from desc);

create table if not exists public.habit_schedule_pauses (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  schedule_version_id uuid not null references public.habit_schedule_versions(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text check (reason is null or char_length(reason) <= 280),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (schedule_version_id, start_date, end_date)
);

create index if not exists habit_schedule_pauses_date_idx
  on public.habit_schedule_pauses(habit_id, start_date, end_date);

-- The first version is a snapshot of the pre-migration daily rule. The local
-- creation date is deliberately derived in the habit's timezone, not UTC.
insert into public.habit_schedule_versions (
  habit_id, version, effective_from, schedule_frequency, schedule_weekdays,
  target_quantity, target_unit, due_time, grace_minutes, timezone, created_by
)
select h.id,
       1,
       ((h.created_at at time zone h.schedule_timezone)::date),
       h.schedule_frequency,
       h.schedule_weekdays,
       h.target_quantity,
       h.target_unit,
       h.due_time,
       h.grace_minutes,
       h.schedule_timezone,
       h.owner_id
from public.habits h
on conflict (habit_id, version) do nothing;

alter table public.habit_schedule_versions enable row level security;
alter table public.habit_schedule_pauses enable row level security;

revoke all on table public.habit_schedule_versions from anon, authenticated;
revoke all on table public.habit_schedule_pauses from anon, authenticated;
grant select on table public.habit_schedule_versions to authenticated;
grant select on table public.habit_schedule_pauses to authenticated;

create policy schedule_versions_select_owner_or_member
on public.habit_schedule_versions for select to authenticated
using (private.habit_visible_to_current_user(habit_id));

create policy schedule_versions_insert_owner
on public.habit_schedule_versions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.habits h
    where h.id = habit_schedule_versions.habit_id
      and h.owner_id = (select auth.uid())
  )
);

create policy schedule_pauses_select_owner_or_member
on public.habit_schedule_pauses for select to authenticated
using (private.habit_visible_to_current_user(habit_id));

create policy schedule_pauses_insert_owner
on public.habit_schedule_pauses for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.habits h
    where h.id = habit_schedule_pauses.habit_id
      and h.owner_id = (select auth.uid())
  )
);

-- No authenticated role can mutate history directly. All changes go through
-- the owner-checked RPC, which closes the previous row before inserting a new
-- version in one transaction.
revoke insert, update, delete on table public.habit_schedule_versions from authenticated;
revoke insert, update, delete on table public.habit_schedule_pauses from authenticated;

create or replace function public.create_habit_schedule_version(
  target_habit_id uuid,
  p_effective_from date,
  p_schedule_frequency text default 'daily',
  p_schedule_weekdays smallint[] default '{}',
  p_target_quantity numeric default 1,
  p_target_unit text default 'count',
  p_due_time time default null,
  p_grace_minutes integer default 0,
  p_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  latest record;
  new_version integer;
  new_version_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.habits h
    where h.id = target_habit_id and h.owner_id = actor
  ) then
    raise exception 'Habit not found or not owned by you';
  end if;
  if p_schedule_frequency not in ('daily', 'selected_weekdays', 'weekly') then
    raise exception 'Unsupported schedule frequency';
  end if;
  if p_schedule_frequency = 'selected_weekdays'
    and cardinality(coalesce(p_schedule_weekdays, '{}')) = 0 then
    raise exception 'Selected weekday schedules need at least one weekday';
  end if;
  if p_target_quantity is null or p_target_quantity <= 0 then
    raise exception 'Target quantity must be greater than zero';
  end if;
  if p_target_unit is null or char_length(trim(p_target_unit)) not between 1 and 40 then
    raise exception 'Target unit must be 1–40 characters';
  end if;
  if p_grace_minutes is null or p_grace_minutes not between 0 and 10080 then
    raise exception 'Grace minutes must be between 0 and 10080';
  end if;
  if p_effective_from is null then raise exception 'Effective date is required'; end if;
  if p_timezone is null then raise exception 'Timezone is required'; end if;
  if exists (
    select 1 from unnest(coalesce(p_schedule_weekdays, '{}')) as day_number
    where day_number < 0 or day_number > 6
  ) then raise exception 'Weekdays must be between 0 and 6'; end if;

  select * into latest
  from public.habit_schedule_versions
  where habit_id = target_habit_id
  order by version desc
  limit 1
  for update;
  if latest.effective_from is not null and p_effective_from <= latest.effective_from then
    raise exception 'Effective date must be after the latest schedule version';
  end if;
  new_version := coalesce(latest.version, 0) + 1;

  if latest.id is not null then
    update public.habit_schedule_versions
    set effective_until = p_effective_from
    where id = latest.id;
  end if;

  insert into public.habit_schedule_versions (
    habit_id, version, effective_from, schedule_frequency, schedule_weekdays,
    target_quantity, target_unit, due_time, grace_minutes, timezone, created_by
  ) values (
    target_habit_id, new_version, p_effective_from, p_schedule_frequency,
    coalesce(p_schedule_weekdays, '{}'), p_target_quantity, trim(p_target_unit),
    p_due_time, p_grace_minutes, p_timezone, actor
  ) returning id into new_version_id;

  update public.habits
  set schedule_frequency = p_schedule_frequency,
      schedule_weekdays = coalesce(p_schedule_weekdays, '{}'),
      target_quantity = p_target_quantity,
      target_unit = trim(p_target_unit),
      due_time = p_due_time,
      grace_minutes = p_grace_minutes,
      schedule_timezone = p_timezone,
      frequency = p_schedule_frequency,
      target_time = p_due_time,
      updated_at = now()
  where id = target_habit_id;

  return new_version_id;
end;
$$;

create or replace function public.create_habit_schedule_pause(
  target_habit_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_version uuid;
  pause_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_end_date < p_start_date then raise exception 'Pause end must be on or after start'; end if;
  select hsv.id into current_version
  from public.habit_schedule_versions hsv
  join public.habits h on h.id = hsv.habit_id
  where hsv.habit_id = target_habit_id
    and h.owner_id = actor
    and hsv.effective_until is null
  order by hsv.version desc
  limit 1;
  if current_version is null then raise exception 'Current schedule version not found'; end if;
  insert into public.habit_schedule_pauses (
    habit_id, schedule_version_id, start_date, end_date, reason, created_by
  ) values (
    target_habit_id, current_version, p_start_date, p_end_date, p_reason, actor
  ) returning id into pause_id;
  return pause_id;
end;
$$;

revoke all on function public.create_habit_schedule_version(uuid, date, text, smallint[], numeric, text, time, integer, text) from public, anon;
grant execute on function public.create_habit_schedule_version(uuid, date, text, smallint[], numeric, text, time, integer, text) to authenticated;
revoke all on function public.create_habit_schedule_pause(uuid, date, date, text) from public, anon;
grant execute on function public.create_habit_schedule_pause(uuid, date, date, text) to authenticated;
