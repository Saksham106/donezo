-- Complete Donezo's notification pipeline.
-- Social writes enqueue authoritative events; pg_cron generates time-based reminders;
-- a bounded Edge Function drains only server-owned rows from this queue.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.notification_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists last_error text;

alter table public.notification_events drop constraint if exists notification_events_status_check;
alter table public.notification_events add constraint notification_events_status_check
  check (status in ('pending', 'processing', 'delivered', 'failed', 'suppressed'));

alter table public.notification_events drop constraint if exists notification_events_attempt_count_check;
alter table public.notification_events add constraint notification_events_attempt_count_check
  check (attempt_count between 0 and 20);

create index if not exists notification_events_pending_created_idx
  on public.notification_events(created_at, id)
  where status in ('pending', 'processing');

-- A proof-backed completion counts only while it remains below the same strict
-- majority rejection threshold used by Donezo's accountability model.
create or replace function private.notification_check_in_valid(target_habit uuid, target_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.check_ins ci
    where ci.habit_id = target_habit
      and ci.check_date = target_date
      and (
        ci.proof_path is null
        or (
          select count(distinct reaction.user_id)
          from public.reactions reaction
          join public.check_in_audience_members viewer
            on viewer.check_in_id = ci.id and viewer.viewer_id = reaction.user_id
          where reaction.check_in_id = ci.id
            and reaction.emoji = '👎'
            and reaction.user_id <> ci.user_id
        ) < floor(((
          select count(*)
          from public.check_in_audience_members audience
          where audience.check_in_id = ci.id and audience.viewer_id <> ci.user_id
        )::numeric) / 2) + 1
      )
  );
$$;
revoke all on function private.notification_check_in_valid(uuid, date) from public, anon, authenticated;

create or replace function private.notification_habit_scheduled_on(target_habit uuid, target_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  habit public.habits%rowtype;
  created_local date;
  weekday smallint;
  weekly_day smallint;
begin
  select * into habit from public.habits where id = target_habit;
  if habit.id is null or habit.active is not true then return false; end if;
  created_local := (habit.created_at at time zone habit.schedule_timezone)::date;
  if target_date < created_local then return false; end if;
  if exists (
    select 1 from public.habit_schedule_pauses pause
    where pause.habit_id = habit.id and target_date between pause.start_date and pause.end_date
  ) then return false; end if;

  weekday := extract(dow from target_date)::smallint;
  if habit.schedule_frequency = 'daily' then return true; end if;
  if habit.schedule_frequency = 'selected_weekdays' then
    return weekday = any(coalesce(habit.schedule_weekdays, '{}'::smallint[]));
  end if;
  if habit.schedule_frequency = 'weekly' then
    weekly_day := coalesce(habit.schedule_weekdays[1], extract(dow from created_local)::smallint);
    return weekday = weekly_day;
  end if;
  -- Flexible weekly goals have no arbitrary daily due occurrence.
  return false;
end;
$$;
revoke all on function private.notification_habit_scheduled_on(uuid, date) from public, anon, authenticated;

create or replace function private.notification_previous_scheduled_date(target_habit uuid, target_date date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  offset_days integer;
  candidate date;
begin
  for offset_days in 1..14 loop
    candidate := target_date - offset_days;
    if private.notification_habit_scheduled_on(target_habit, candidate) then return candidate; end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.notification_previous_scheduled_date(uuid, date) from public, anon, authenticated;

-- Claim rows atomically so cron wakes and immediate social wakes cannot double-send.
create or replace function public.claim_notification_events(batch_limit integer default 25)
returns setof public.notification_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select event.id
    from public.notification_events event
    where event.status = 'pending'
       or (event.status = 'processing' and event.processing_started_at < now() - interval '10 minutes')
    order by event.created_at, event.id
    for update skip locked
    limit greatest(1, least(coalesce(batch_limit, 25), 100))
  )
  update public.notification_events event
  set status = 'processing',
      processing_started_at = now(),
      attempt_count = event.attempt_count + 1,
      last_error = null
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;
revoke all on function public.claim_notification_events(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_events(integer) to service_role;

-- Check-in visibility is already snapshotted transactionally. Queue social
-- activity only to those immutable viewers; current friendship changes never
-- expand a historical notification audience.
create or replace function private.queue_check_in_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  habit public.habits%rowtype;
  actor_name text;
  viewer uuid;
  challenge record;
  participant uuid;
begin
  select * into habit from public.habits where id = new.habit_id;
  select display_name into actor_name from public.profiles where id = new.user_id;
  actor_name := coalesce(actor_name, 'A friend');

  for viewer in
    select audience.viewer_id
    from public.check_in_audience_members audience
    where audience.check_in_id = new.id and audience.viewer_id <> new.user_id
  loop
    perform public.enqueue_notification_event(
      target_recipient_user_id => viewer,
      target_notification_category => 'friend_activity',
      target_notification_dedupe_key => 'friend_activity:' || new.id::text,
      target_notification_group_key => 'friend_activity:' || new.habit_id::text,
      target_notification_title => left(actor_name || ' checked in', 120),
      target_notification_body => left(actor_name || ' finished ' || habit.title || '. Your move.', 280),
      target_notification_deep_link => '/?tab=friends&checkIn=' || new.id::text,
      target_notification_habit_id => new.habit_id,
      target_notification_circle_id => habit.circle_id,
      target_source_user_id => new.user_id,
      target_notification_metadata => jsonb_build_object(
        'checkInId', new.id, 'habitId', new.habit_id,
        'actorName', actor_name, 'habitTitle', habit.title, 'source', 'check_in'
      )
    );
  end loop;

  -- One challenge update per participant/challenge/day avoids turning every
  -- check-in into spam while still making this preference real.
  for challenge in
    select c.id, c.circle_id, c.title
    from public.weekly_challenges c
    where c.circle_id = habit.circle_id
      and c.status = 'active'
      and new.check_date between c.starts_on and c.ends_on
  loop
    for participant in
      select cp.user_id
      from public.challenge_participants cp
      where cp.challenge_id = challenge.id
        and cp.opted_out_at is null
        and cp.user_id <> new.user_id
    loop
      perform public.enqueue_notification_event(
        target_recipient_user_id => participant,
        target_notification_category => 'challenge_progress',
        target_notification_dedupe_key => 'challenge_progress:' || challenge.id::text || ':' || new.check_date::text,
        target_notification_group_key => 'challenge_progress:' || challenge.id::text,
        target_notification_title => left(challenge.title || ' moved forward', 120),
        target_notification_body => 'Your crew made progress today. Keep it moving.',
        target_notification_deep_link => '/?tab=league&circle=' || challenge.circle_id::text,
        target_notification_circle_id => challenge.circle_id,
        target_source_user_id => new.user_id,
        target_notification_metadata => jsonb_build_object(
          'challengeId', challenge.id, 'checkInId', new.id, 'source', 'challenge_progress'
        )
      );
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.queue_check_in_notifications() from public, anon, authenticated;
drop trigger if exists zz_queue_check_in_notifications on public.check_ins;
create trigger zz_queue_check_in_notifications
  after insert on public.check_ins
  for each row execute function private.queue_check_in_notifications();

create or replace function private.queue_reaction_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_in public.check_ins%rowtype;
  habit public.habits%rowtype;
  actor_name text;
begin
  -- Proof rejection has its own in-app flow; don't disguise it as a positive reaction.
  if new.emoji = '👎' then return new; end if;
  select * into check_in from public.check_ins where id = new.check_in_id;
  if check_in.id is null or check_in.user_id = new.user_id then return new; end if;
  select * into habit from public.habits where id = check_in.habit_id;
  select display_name into actor_name from public.profiles where id = new.user_id;
  actor_name := coalesce(actor_name, 'A friend');
  perform public.enqueue_notification_event(
    target_recipient_user_id => check_in.user_id,
    target_notification_category => 'reaction',
    target_notification_dedupe_key => 'reaction:' || new.check_in_id::text || ':' || new.user_id::text,
    target_notification_group_key => 'reaction:' || new.check_in_id::text,
    target_notification_title => left(actor_name || ' reacted to your check-in', 120),
    target_notification_body => left(actor_name || ' hit ' || new.emoji || ' on ' || habit.title || '.', 280),
    target_notification_deep_link => '/?tab=friends&checkIn=' || new.check_in_id::text,
    target_notification_habit_id => check_in.habit_id,
    target_notification_circle_id => habit.circle_id,
    target_source_user_id => new.user_id,
    target_notification_metadata => jsonb_build_object(
      'checkInId', new.check_in_id, 'habitId', check_in.habit_id,
      'emoji', new.emoji, 'actorName', actor_name, 'source', 'reaction'
    )
  );
  return new;
end;
$$;
revoke all on function private.queue_reaction_notification() from public, anon, authenticated;
drop trigger if exists queue_reaction_notification on public.reactions;
create trigger queue_reaction_notification
  after insert on public.reactions
  for each row execute function private.queue_reaction_notification();

create or replace function private.queue_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_in public.check_ins%rowtype;
  habit public.habits%rowtype;
  actor_name text;
begin
  select * into check_in from public.check_ins where id = new.check_in_id;
  if check_in.id is null or check_in.user_id = new.author_id then return new; end if;
  select * into habit from public.habits where id = check_in.habit_id;
  select display_name into actor_name from public.profiles where id = new.author_id;
  actor_name := coalesce(actor_name, 'A friend');
  perform public.enqueue_notification_event(
    target_recipient_user_id => check_in.user_id,
    target_notification_category => 'comment',
    target_notification_dedupe_key => 'comment:' || new.id::text,
    target_notification_group_key => 'comment:' || new.check_in_id::text,
    target_notification_title => left(actor_name || ' replied to your check-in', 120),
    target_notification_body => left(actor_name || ' added something to ' || habit.title || '.', 280),
    target_notification_deep_link => '/?tab=friends&checkIn=' || new.check_in_id::text,
    target_notification_habit_id => check_in.habit_id,
    target_notification_circle_id => habit.circle_id,
    target_source_user_id => new.author_id,
    target_notification_metadata => jsonb_build_object(
      'checkInId', new.check_in_id, 'commentId', new.id,
      'habitId', check_in.habit_id, 'actorName', actor_name, 'source', 'comment'
    )
  );
  return new;
end;
$$;
revoke all on function private.queue_comment_notification() from public, anon, authenticated;
drop trigger if exists queue_comment_notification on public.check_in_comments;
create trigger queue_comment_notification
  after insert on public.check_in_comments
  for each row execute function private.queue_comment_notification();

-- Cron calls this every minute. Dedupe keys make the time windows tolerant of
-- delayed runs without repeated pushes.
create or replace function public.enqueue_scheduled_notification_events(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  habit public.habits%rowtype;
  local_now timestamp;
  local_date date;
  local_time time;
  due_local timestamp;
  risk_local timestamp;
  previous_date date;
  enqueue_result jsonb;
  generated integer := 0;
  week_start date;
  effective_target integer;
  completed_days integer;
  eligible_days integer;
  latest_version integer;
  latest_effective_from date;
begin
  for habit in select * from public.habits where active loop
    begin
      local_now := at_time at time zone habit.schedule_timezone;
    exception when others then
      continue;
    end;
    local_date := local_now::date;
    local_time := local_now::time;

    if habit.schedule_frequency <> 'times_per_week'
      and private.notification_habit_scheduled_on(habit.id, local_date)
      and not private.notification_check_in_valid(habit.id, local_date) then

      if habit.due_time is not null then
        due_local := local_date + habit.due_time;
        if local_now >= due_local - interval '30 minutes' and local_now < due_local then
          enqueue_result := public.enqueue_notification_event(
            target_recipient_user_id => habit.owner_id,
            target_notification_category => 'due_soon',
            target_notification_dedupe_key => 'due_soon:' || habit.id::text || ':' || local_date::text,
            target_notification_group_key => 'due_soon:' || habit.id::text,
            target_notification_title => left(habit.title || ' is coming up', 120),
            target_notification_body => left('Quick heads-up: ' || habit.title || ' is due soon. Lock it in.', 280),
            target_notification_deep_link => '/?tab=checkin&habit=' || habit.id::text,
            target_notification_habit_id => habit.id,
            target_notification_circle_id => habit.circle_id,
            target_notification_metadata => jsonb_build_object('habitId', habit.id, 'localDate', local_date, 'source', 'due_soon'),
            target_notification_at => at_time
          );
          if coalesce((enqueue_result ->> 'accepted')::boolean, false) then generated := generated + 1; end if;
        end if;
      end if;

      previous_date := private.notification_previous_scheduled_date(habit.id, local_date);
      if previous_date is not null and private.notification_check_in_valid(habit.id, previous_date) then
        if habit.due_time is null then
          risk_local := local_date + time '20:00';
        else
          risk_local := local_date + habit.due_time + make_interval(mins => habit.grace_minutes);
          if risk_local > local_date + time '23:00' then risk_local := local_date + time '23:00'; end if;
        end if;
        if local_now >= risk_local and local_now < risk_local + interval '30 minutes' then
          enqueue_result := public.enqueue_notification_event(
            target_recipient_user_id => habit.owner_id,
            target_notification_category => 'streak_risk',
            target_notification_dedupe_key => 'streak_risk:' || habit.id::text || ':' || local_date::text,
            target_notification_group_key => 'streak_risk:' || habit.id::text,
            target_notification_title => 'Don’t sell the streak now',
            target_notification_body => left(habit.title || ' is still open today. One check-in keeps it alive.', 280),
            target_notification_deep_link => '/?tab=checkin&habit=' || habit.id::text,
            target_notification_habit_id => habit.id,
            target_notification_circle_id => habit.circle_id,
            target_notification_metadata => jsonb_build_object('habitId', habit.id, 'localDate', local_date, 'source', 'streak_risk'),
            target_notification_at => at_time
          );
          if coalesce((enqueue_result ->> 'accepted')::boolean, false) then generated := generated + 1; end if;
        end if;
      end if;
    end if;

    -- Flexible weekly goals have no fake daily miss. Only Sunday can produce a
    -- risk reminder, and partial activation weeks stay exempt.
    if habit.schedule_frequency = 'times_per_week'
      and extract(dow from local_date)::integer = 0
      and local_time >= time '18:00' then
      week_start := local_date - 6;
      select version, effective_from into latest_version, latest_effective_from
      from public.habit_schedule_versions
      where habit_id = habit.id and effective_from <= local_date
      order by version desc limit 1;
      if latest_effective_from is null then
        latest_version := 1;
        latest_effective_from := (habit.created_at at time zone habit.schedule_timezone)::date;
      end if;
      if (coalesce(latest_version, 1) = 1 and latest_effective_from >= week_start)
        or (coalesce(latest_version, 1) > 1 and latest_effective_from > week_start) then
        continue;
      end if;

      select count(*)::integer into eligible_days
      from generate_series(0, 6) offset_day
      where not exists (
        select 1 from public.habit_schedule_pauses pause
        where pause.habit_id = habit.id
          and (week_start + offset_day::integer) between pause.start_date and pause.end_date
      );
      effective_target := least(habit.weekly_target_days, eligible_days);
      select count(*)::integer into completed_days
      from generate_series(0, 6) offset_day
      where private.notification_check_in_valid(habit.id, week_start + offset_day::integer);
      completed_days := least(completed_days, effective_target);

      if effective_target > 0 and completed_days < effective_target then
        enqueue_result := public.enqueue_notification_event(
          target_recipient_user_id => habit.owner_id,
          target_notification_category => 'streak_risk',
          target_notification_dedupe_key => 'weekly_risk:' || habit.id::text || ':' || week_start::text,
          target_notification_group_key => 'streak_risk:' || habit.id::text,
          target_notification_title => left(habit.title || ': Sunday save?', 120),
          target_notification_body => left(habit.title || ' is ' || completed_days || '/' || effective_target || ' this week. Still time to close it out.', 280),
          target_notification_deep_link => '/?tab=checkin&habit=' || habit.id::text,
          target_notification_habit_id => habit.id,
          target_notification_circle_id => habit.circle_id,
          target_notification_metadata => jsonb_build_object(
            'habitId', habit.id, 'weekStart', week_start,
            'completedDays', completed_days, 'targetDays', effective_target, 'source', 'weekly_streak_risk'
          ),
          target_notification_at => at_time
        );
        if coalesce((enqueue_result ->> 'accepted')::boolean, false) then generated := generated + 1; end if;
      end if;
    end if;
  end loop;
  return generated;
end;
$$;
revoke all on function public.enqueue_scheduled_notification_events(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_scheduled_notification_events(timestamptz) to service_role;

-- Wake the worker immediately for social events. Time-based events are already
-- produced inside the cron worker, so excluding them avoids recursive wakes.
create or replace function private.wake_notification_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://kiqntckwcqxkxgpuajyi.supabase.co/functions/v1/notification-worker',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke all on function private.wake_notification_worker() from public, anon, authenticated;
drop trigger if exists wake_notification_worker on public.notification_events;
create trigger wake_notification_worker
  after insert on public.notification_events
  for each row
  when (new.status = 'pending' and new.category in ('friend_activity', 'reaction', 'comment', 'challenge_progress'))
  execute function private.wake_notification_worker();

-- Cron is a reliability backstop and the producer for time-based reminders.
do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'donezo-notification-worker' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'donezo-notification-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://kiqntckwcqxkxgpuajyi.supabase.co/functions/v1/notification-worker',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $cron$
);
