-- Flexible weekly habit schedules.
-- Adds an explicit number-of-days target without changing per-occurrence quantity semantics.

alter table public.habits
  add column if not exists weekly_target_days integer not null default 1;

alter table public.habit_schedule_versions
  add column if not exists weekly_target_days integer not null default 1;

alter table public.habits drop constraint if exists habits_schedule_frequency_check;
alter table public.habits add constraint habits_schedule_frequency_check
  check (schedule_frequency in ('daily', 'selected_weekdays', 'weekly', 'times_per_week'));

alter table public.habit_schedule_versions
  drop constraint if exists habit_schedule_versions_schedule_frequency_check;
alter table public.habit_schedule_versions
  add constraint habit_schedule_versions_schedule_frequency_check
  check (schedule_frequency in ('daily', 'selected_weekdays', 'weekly', 'times_per_week'));

alter table public.habits drop constraint if exists habits_weekly_target_days_check;
alter table public.habits add constraint habits_weekly_target_days_check
  check (weekly_target_days between 1 and 7);

alter table public.habit_schedule_versions
  drop constraint if exists habit_schedule_versions_weekly_target_days_check;
alter table public.habit_schedule_versions
  add constraint habit_schedule_versions_weekly_target_days_check
  check (weekly_target_days between 1 and 7);

-- Keep the initial immutable schedule snapshot complete if a future caller
-- inserts a flexible schedule directly. Existing creation flows can still
-- replace the same-day snapshot through the owner-checked RPC.
create or replace function private.capture_initial_habit_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.habit_schedule_versions (
    habit_id, version, effective_from, schedule_frequency, schedule_weekdays,
    weekly_target_days, target_quantity, target_unit, due_time, grace_minutes,
    timezone, created_by
  ) values (
    new.id, 1, (new.created_at at time zone new.schedule_timezone)::date,
    new.schedule_frequency, new.schedule_weekdays, new.weekly_target_days,
    new.target_quantity, new.target_unit, new.due_time, new.grace_minutes,
    new.schedule_timezone, new.owner_id
  ) on conflict (habit_id, version) do nothing;
  return new;
end;
$$;

revoke all on function private.capture_initial_habit_schedule() from public, anon, authenticated;

-- The added default parameter keeps old callers compatible while newer clients
-- can persist the distinct-days weekly target explicitly.
drop function if exists public.create_habit_schedule_version(
  uuid, date, text, smallint[], numeric, text, time without time zone, integer, text
);

create or replace function public.create_habit_schedule_version(
  target_habit_id uuid,
  p_effective_from date,
  p_schedule_frequency text default 'daily',
  p_schedule_weekdays smallint[] default '{}',
  p_target_quantity numeric default 1,
  p_target_unit text default 'count',
  p_due_time time default null,
  p_grace_minutes integer default 0,
  p_timezone text default 'America/New_York',
  p_weekly_target_days integer default 1
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
  if p_schedule_frequency not in ('daily', 'selected_weekdays', 'weekly', 'times_per_week') then
    raise exception 'Unsupported schedule frequency';
  end if;
  if p_schedule_frequency = 'selected_weekdays'
    and cardinality(coalesce(p_schedule_weekdays, '{}')) = 0 then
    raise exception 'Selected weekday schedules need at least one weekday';
  end if;
  if p_weekly_target_days is null or p_weekly_target_days not between 1 and 7 then
    raise exception 'Days per week must be between 1 and 7';
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

  if latest.effective_from = p_effective_from then
    if exists (
      select 1 from public.check_ins ci
      where ci.habit_id = target_habit_id and ci.check_date = p_effective_from
    ) then raise exception 'Today already has a check-in; edit the schedule tomorrow'; end if;

    update public.habit_schedule_versions
    set schedule_frequency = p_schedule_frequency,
        schedule_weekdays = coalesce(p_schedule_weekdays, '{}'),
        weekly_target_days = p_weekly_target_days,
        target_quantity = p_target_quantity,
        target_unit = trim(p_target_unit),
        due_time = p_due_time,
        grace_minutes = p_grace_minutes,
        timezone = p_timezone
    where id = latest.id;

    update public.habits
    set schedule_frequency = p_schedule_frequency,
        schedule_weekdays = coalesce(p_schedule_weekdays, '{}'),
        weekly_target_days = p_weekly_target_days,
        target_quantity = p_target_quantity,
        target_unit = trim(p_target_unit),
        due_time = p_due_time,
        grace_minutes = p_grace_minutes,
        schedule_timezone = p_timezone,
        frequency = p_schedule_frequency,
        target_time = p_due_time,
        updated_at = now()
    where id = target_habit_id;
    return latest.id;
  end if;

  if latest.effective_from is not null and p_effective_from < latest.effective_from then
    raise exception 'Effective date must not precede the latest schedule version';
  end if;
  new_version := coalesce(latest.version, 0) + 1;

  if latest.id is not null then
    update public.habit_schedule_versions
    set effective_until = p_effective_from
    where id = latest.id;
  end if;

  insert into public.habit_schedule_versions (
    habit_id, version, effective_from, schedule_frequency, schedule_weekdays,
    weekly_target_days, target_quantity, target_unit, due_time, grace_minutes,
    timezone, created_by
  ) values (
    target_habit_id, new_version, p_effective_from, p_schedule_frequency,
    coalesce(p_schedule_weekdays, '{}'), p_weekly_target_days,
    p_target_quantity, trim(p_target_unit), p_due_time, p_grace_minutes,
    p_timezone, actor
  ) returning id into new_version_id;

  update public.habits
  set schedule_frequency = p_schedule_frequency,
      schedule_weekdays = coalesce(p_schedule_weekdays, '{}'),
      weekly_target_days = p_weekly_target_days,
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

revoke all on function public.create_habit_schedule_version(
  uuid, date, text, smallint[], numeric, text, time without time zone, integer, text, integer
) from public, anon;
grant execute on function public.create_habit_schedule_version(
  uuid, date, text, smallint[], numeric, text, time without time zone, integer, text, integer
) to authenticated;
