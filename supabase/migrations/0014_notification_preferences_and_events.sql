-- Contextual notification controls and server-owned delivery events.
-- Preferences are user-owned; events are written only by the delivery backend.

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  timezone text not null default 'America/New_York'
    check (char_length(timezone) between 1 and 100),
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  categories jsonb not null default '{"due_soon": true, "streak_risk": true, "friend_activity": true, "nudge": true, "reaction": true, "comment": true, "challenge_progress": true}'::jsonb
    check (jsonb_typeof(categories) = 'object'),
  habit_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(habit_overrides) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  source_user_id uuid references public.profiles(id) on delete set null,
  source_nudge_id uuid references public.nudges(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete set null,
  habit_id uuid references public.habits(id) on delete set null,
  category text not null check (category in (
    'due_soon', 'streak_risk', 'friend_activity', 'nudge',
    'reaction', 'comment', 'challenge_progress'
  )),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 255),
  group_key text not null check (char_length(group_key) between 1 and 255),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 280),
  deep_link text not null check (deep_link like '/%' and deep_link not like '//%'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'suppressed')),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);

create index if not exists notification_events_recipient_created_idx
  on public.notification_events(recipient_user_id, created_at desc);
create index if not exists notification_events_group_created_idx
  on public.notification_events(recipient_user_id, group_key, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;

revoke all on table public.notification_preferences from anon, authenticated;
revoke all on table public.notification_events from anon, authenticated;
revoke insert, update, delete on table public.notification_events from authenticated;
grant select, insert, update, delete on table public.notification_preferences to authenticated;
grant select on table public.notification_events to authenticated;
grant select on table public.notification_preferences to service_role;
grant select, insert, update on table public.notification_events to service_role;

create policy notification_preferences_owner_select
on public.notification_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy notification_preferences_owner_insert
on public.notification_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy notification_preferences_owner_update
on public.notification_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy notification_preferences_owner_delete
on public.notification_preferences for delete to authenticated
using (user_id = (select auth.uid()));

create policy notification_events_recipient
on public.notification_events for select to authenticated
using (recipient_user_id = (select auth.uid()));

create or replace function private.notification_preference_allows(
  target_user uuid,
  target_category text,
  target_habit uuid,
  at_time timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preference public.notification_preferences%rowtype;
  habit_override jsonb;
  habit_category_override boolean;
  local_time time;
  quiet_start time;
  quiet_end time;
begin
  if target_category not in (
    'due_soon', 'streak_risk', 'friend_activity', 'nudge',
    'reaction', 'comment', 'challenge_progress'
  ) then
    return false;
  end if;

  select * into preference
  from public.notification_preferences
  where user_id = target_user;
  if not found then return true; end if;

  if not exists (select 1 from pg_timezone_names where name = preference.timezone) then
    return false;
  end if;
  if target_habit is not null then
    habit_override := preference.habit_overrides -> target_habit::text;
    if jsonb_typeof(habit_override) = 'boolean' then
      habit_category_override := (habit_override #>> '{}')::boolean;
    elsif jsonb_typeof(habit_override) = 'object'
      and jsonb_typeof(habit_override -> target_category) = 'boolean' then
      habit_category_override := (habit_override ->> target_category)::boolean;
    end if;
  end if;

  if habit_category_override is not true
     and jsonb_typeof(preference.categories -> target_category) = 'boolean'
     and coalesce((preference.categories ->> target_category)::boolean, false) = false then
    return false;
  end if;
  if habit_category_override is false then return false; end if;

  if not preference.quiet_hours_enabled then return true; end if;
  quiet_start := preference.quiet_hours_start;
  quiet_end := preference.quiet_hours_end;
  if quiet_start = quiet_end then return true; end if;
  local_time := (at_time at time zone preference.timezone)::time;
  if quiet_start < quiet_end then
    return local_time < quiet_start or local_time >= quiet_end;
  end if;
  -- Overnight window, for example 22:00–08:00.
  return local_time >= quiet_end and local_time < quiet_start;
end;
$$;

revoke all on function private.notification_preference_allows(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.notification_preference_allows(uuid, text, uuid, timestamptz)
  to service_role;

-- One server-owned entry point applies preferences and lets the unique key make
-- retries idempotent. A null event means the preference policy suppressed it;
-- deduped distinguishes an already-created event from a new one.
create or replace function public.enqueue_notification_event(
  target_recipient_user_id uuid,
  target_notification_category text,
  target_notification_dedupe_key text,
  target_notification_group_key text,
  target_notification_title text,
  target_notification_body text,
  target_notification_deep_link text,
  target_notification_habit_id uuid default null,
  target_notification_circle_id uuid default null,
  target_source_user_id uuid default null,
  target_source_nudge_id uuid default null,
  target_notification_metadata jsonb default '{}'::jsonb,
  target_notification_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  if not private.notification_preference_allows(
    target_recipient_user_id, target_notification_category, target_notification_habit_id, target_notification_at
  ) then
    return jsonb_build_object('accepted', false, 'suppressed', true, 'deduped', false);
  end if;

  insert into public.notification_events (
    recipient_user_id, source_user_id, source_nudge_id, circle_id, habit_id,
    category, dedupe_key, group_key, title, body, deep_link, metadata
  ) values (
    target_recipient_user_id, target_source_user_id, target_source_nudge_id, target_notification_circle_id,
    target_notification_habit_id, target_notification_category, target_notification_dedupe_key,
    target_notification_group_key, target_notification_title, target_notification_body,
    target_notification_deep_link, coalesce(target_notification_metadata, '{}'::jsonb)
  )
  on conflict (recipient_user_id, dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    return jsonb_build_object('accepted', false, 'suppressed', false, 'deduped', true);
  end if;
  return jsonb_build_object('accepted', true, 'suppressed', false, 'deduped', false, 'eventId', event_id);
end;
$$;

revoke all on function public.enqueue_notification_event(
  uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_notification_event(
  uuid, text, text, text, text, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz
) to service_role;
