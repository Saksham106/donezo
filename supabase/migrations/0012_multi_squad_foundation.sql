-- Multi-squad foundation: users may join several squads, habits can be shared
-- into several squads, and callouts may be visible to the whole squad.

-- 0008 temporarily enforced one membership per user. Multi-squad membership is
-- now intentional, while the existing (circle_id, user_id) primary key still
-- prevents duplicate membership in the same squad.
drop index if exists public.circle_members_one_circle_per_user;

create table if not exists public.habit_circles (
  habit_id uuid not null references public.habits(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (habit_id, circle_id)
);

create index if not exists habit_circles_circle_id_idx
  on public.habit_circles(circle_id, habit_id);

insert into public.habit_circles (habit_id, circle_id)
select id, circle_id from public.habits
on conflict (habit_id, circle_id) do nothing;

alter table public.habit_circles enable row level security;

-- Sharing mutations must stay atomic with the habit row. Clients may inspect
-- visible shares, but only the SECURITY DEFINER RPCs below may write them.
revoke insert, delete on public.habit_circles from authenticated;
grant select on public.habit_circles to authenticated;

create or replace function private.habit_visible_to_current_user(target_habit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.habits h
    where h.id = target_habit
      and (
        h.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.habit_circles hc
          join public.circle_members cm on cm.circle_id = hc.circle_id
          where hc.habit_id = h.id
            and cm.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function private.user_can_manage_habit_share(
  target_habit uuid,
  target_circle uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.habits h
    join public.circle_members cm
      on cm.circle_id = target_circle
     and cm.user_id = (select auth.uid())
    where h.id = target_habit
      and h.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.habit_visible_to_current_user(uuid) from public;
revoke all on function private.user_can_manage_habit_share(uuid, uuid) from public;
grant execute on function private.habit_visible_to_current_user(uuid) to authenticated;
grant execute on function private.user_can_manage_habit_share(uuid, uuid) to authenticated;

drop policy if exists habit_circles_select_visible on public.habit_circles;
create policy habit_circles_select_visible
on public.habit_circles for select to authenticated
using (
  private.habit_visible_to_current_user(habit_id)
  and (
    exists (
      select 1 from public.habits h
      where h.id = habit_id and h.owner_id = (select auth.uid())
    )
    or circle_id in (select private.user_circle_ids())
  )
);

drop policy if exists habit_circles_insert_owner on public.habit_circles;
create policy habit_circles_insert_owner
on public.habit_circles for insert to authenticated
with check (private.user_can_manage_habit_share(habit_id, circle_id));

drop policy if exists habit_circles_delete_owner on public.habit_circles;
create policy habit_circles_delete_owner
on public.habit_circles for delete to authenticated
using (private.user_can_manage_habit_share(habit_id, circle_id));

-- Habit visibility and mutation now resolve through the exact sharing rows.
drop policy if exists habits_select_circle on public.habits;
drop policy if exists habits_select_circle_members on public.habits;
drop policy if exists habits_insert_owner on public.habits;
drop policy if exists habits_update_owner on public.habits;
drop policy if exists habits_delete_owner on public.habits;
drop policy if exists habits_delete_active_owner on public.habits;

create policy habits_select_shared
on public.habits for select to authenticated
using (private.habit_visible_to_current_user(id));

-- Direct inserts remain safe for compatibility. The atomic RPC below is the
-- supported client path because it also creates the share rows.
create policy habits_insert_owner
on public.habits for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and circle_id in (select private.user_circle_ids())
);

create policy habits_update_owner
on public.habits for update to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.habit_circles hc
    join public.circle_members cm on cm.circle_id = hc.circle_id
    where hc.habit_id = habits.id and cm.user_id = (select auth.uid())
  )
)
with check (owner_id = (select auth.uid()));

create policy habits_delete_owner
on public.habits for delete to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.habit_circles hc
    join public.circle_members cm on cm.circle_id = hc.circle_id
    where hc.habit_id = habits.id
      and cm.user_id = (select auth.uid())
  )
);

-- Habit creation and full edits must use the atomic RPCs. The client only
-- needs direct UPDATE for archiving an owned habit.
revoke insert on public.habits from authenticated;
revoke update on public.habits from authenticated;
grant update (active, updated_at) on public.habits to authenticated;

-- Check-ins and reactions inherit exact visibility from the habit's shares.
drop policy if exists check_ins_select_circle on public.check_ins;
drop policy if exists check_ins_select_circle_members on public.check_ins;
drop policy if exists check_ins_insert_self on public.check_ins;
drop policy if exists check_ins_update_self on public.check_ins;
drop policy if exists check_ins_delete_self on public.check_ins;
drop policy if exists check_ins_delete_active_self on public.check_ins;

create policy check_ins_select_shared
on public.check_ins for select to authenticated
using (private.habit_visible_to_current_user(habit_id));

create policy check_ins_insert_self
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
  and check_date = (select private.current_user_date())
  and exists (
    select 1
    from public.habits h
    join public.habit_circles hc on hc.habit_id = h.id
    join public.circle_members cm
      on cm.circle_id = hc.circle_id
     and cm.user_id = (select auth.uid())
    where h.id = check_ins.habit_id
      and h.owner_id = (select auth.uid())
      and h.active
      and (
        (h.proof_mode = 'none' and proof_path is null)
        or (
          h.proof_mode = 'photo'
          and proof_path is not null
          and proof_path like ((select auth.uid())::text || '/' || habit_id::text || '-%')
          and (select private.proof_object_exists(proof_path))
        )
      )
  )
);

create policy check_ins_delete_self
on public.check_ins for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.habits h
    join public.habit_circles hc on hc.habit_id = h.id
    join public.circle_members cm
      on cm.circle_id = hc.circle_id
     and cm.user_id = (select auth.uid())
    where h.id = check_ins.habit_id
      and h.owner_id = (select auth.uid())
  )
);

-- Check-ins are immutable after creation.

drop policy if exists reactions_select_circle on public.reactions;
drop policy if exists reactions_select_visible_checkins on public.reactions;
drop policy if exists reactions_select_circle_checkins on public.reactions;
drop policy if exists reactions_insert_self on public.reactions;
drop policy if exists reactions_insert_circle_peer on public.reactions;
drop policy if exists reactions_update_self on public.reactions;
revoke update on public.reactions from authenticated;

drop policy if exists reactions_delete_self on public.reactions;

create policy reactions_select_shared
on public.reactions for select to authenticated
using (
  exists (
    select 1 from public.check_ins ci
    where ci.id = reactions.check_in_id
      and private.habit_visible_to_current_user(ci.habit_id)
  )
);

create policy reactions_insert_self
on public.reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.check_ins ci
    where ci.id = reactions.check_in_id
      and private.habit_visible_to_current_user(ci.habit_id)
      and (
        emoji <> '👎'
        or (ci.proof_path is not null and ci.user_id <> (select auth.uid()))
      )
  )
);

create policy reactions_delete_self
on public.reactions for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.check_ins ci
    where ci.id = reactions.check_in_id
      and private.habit_visible_to_current_user(ci.habit_id)
  )
);

-- Storage proof reads remain tied to a real check-in and now resolve the exact
-- set of squads where that habit is shared.
create or replace function private.can_view_proof(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.check_ins ci
    join public.habit_circles hc on hc.habit_id = ci.habit_id
    join public.circle_members viewer
      on viewer.circle_id = hc.circle_id
     and viewer.user_id = (select auth.uid())
    where ci.proof_path = target_path
  );
$$;

revoke all on function private.can_view_proof(text) from public;
grant execute on function private.can_view_proof(text) to authenticated;

-- Public callouts share the existing nudge delivery path but are readable by
-- every member of the exact squad. Private nudges remain sender/recipient only.
alter table public.nudges
  add column if not exists visibility text not null default 'private';

alter table public.nudges
  drop constraint if exists nudges_visibility_check;
alter table public.nudges
  add constraint nudges_visibility_check
  check (visibility in ('private', 'squad'));

create index if not exists nudges_circle_visibility_created_idx
  on public.nudges(circle_id, visibility, created_at desc);

drop policy if exists nudges_select_sender_or_recipient on public.nudges;
drop policy if exists nudges_insert_sender on public.nudges;

create policy nudges_select_by_visibility
on public.nudges for select to authenticated
using (
  case
    when visibility = 'squad' then circle_id in (select private.user_circle_ids())
    else from_user_id = (select auth.uid()) or to_user_id = (select auth.uid())
  end
);

create policy nudges_insert_sender
on public.nudges for insert to authenticated
with check (
  from_user_id = (select auth.uid())
  and from_user_id <> to_user_id
  and visibility in ('private', 'squad')
  and exists (
    select 1 from public.circle_members sender
    where sender.circle_id = nudges.circle_id
      and sender.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.circle_members recipient
    where recipient.circle_id = nudges.circle_id
      and recipient.user_id = nudges.to_user_id
  )
);

-- Habit and share changes are atomic. SECURITY DEFINER is necessary because an
-- insert cannot satisfy share-based visibility until the habit row exists.
create or replace function public.create_habit_with_squads(
  requested_squads uuid[],
  habit_title text,
  habit_emoji text,
  habit_frequency text,
  habit_target_time time default null,
  habit_proof_mode text default 'photo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_habit_id uuid;
  membership_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if habit_title is null or char_length(trim(habit_title)) not between 1 and 80 then
    raise exception 'Habit title must be 1–80 characters';
  end if;
  if habit_frequency <> 'daily' then raise exception 'Unsupported habit frequency'; end if;
  if habit_proof_mode not in ('none', 'photo') then raise exception 'Unsupported proof mode'; end if;
  if requested_squads is null or cardinality(requested_squads) = 0 then
    raise exception 'Choose at least one squad';
  end if;
  if (select count(distinct requested.circle_id) from unnest(requested_squads) as requested(circle_id))
       <> cardinality(requested_squads) then
    raise exception 'Duplicate squads are not allowed';
  end if;

  select count(*) into membership_count
  from (
    select cm.circle_id
    from public.circle_members cm
    where cm.user_id = actor and cm.circle_id = any(requested_squads)
    for key share
  ) locked_memberships;
  if membership_count <> cardinality(requested_squads) then
    raise exception 'You must belong to every selected squad';
  end if;

  insert into public.habits (
    circle_id, owner_id, title, emoji, frequency, target_time, proof_mode
  ) values (
    requested_squads[1], actor, trim(habit_title), habit_emoji,
    habit_frequency, habit_target_time, habit_proof_mode
  ) returning id into new_habit_id;

  insert into public.habit_circles (habit_id, circle_id)
  select new_habit_id, requested.circle_id
  from unnest(requested_squads) as requested(circle_id);

  return new_habit_id;
end;
$$;

create or replace function public.update_habit_with_squads(
  target_habit_id uuid,
  requested_squads uuid[],
  habit_title text,
  habit_emoji text,
  habit_frequency text,
  habit_target_time time default null,
  habit_proof_mode text default 'photo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  membership_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if habit_title is null or char_length(trim(habit_title)) not between 1 and 80 then
    raise exception 'Habit title must be 1–80 characters';
  end if;
  if habit_frequency <> 'daily' then raise exception 'Unsupported habit frequency'; end if;
  if habit_proof_mode not in ('none', 'photo') then raise exception 'Unsupported proof mode'; end if;
  if requested_squads is null or cardinality(requested_squads) = 0 then
    raise exception 'Choose at least one squad';
  end if;
  if (select count(distinct requested.circle_id) from unnest(requested_squads) as requested(circle_id))
       <> cardinality(requested_squads) then
    raise exception 'Duplicate squads are not allowed';
  end if;

  select count(*) into membership_count
  from (
    select cm.circle_id
    from public.circle_members cm
    where cm.user_id = actor and cm.circle_id = any(requested_squads)
    for key share
  ) locked_memberships;
  if membership_count <> cardinality(requested_squads) then
    raise exception 'You must belong to every selected squad';
  end if;

  update public.habits
  set circle_id = requested_squads[1],
      title = trim(habit_title),
      emoji = habit_emoji,
      frequency = habit_frequency,
      target_time = habit_target_time,
      proof_mode = habit_proof_mode,
      updated_at = now()
  where id = target_habit_id and owner_id = actor;

  if not found then raise exception 'Habit not found or not owned by you'; end if;

  delete from public.habit_circles where habit_id = target_habit_id;
  insert into public.habit_circles (habit_id, circle_id)
  select target_habit_id, requested.circle_id
  from unnest(requested_squads) as requested(circle_id);

  return target_habit_id;
end;
$$;

revoke all on function public.create_habit_with_squads(uuid[], text, text, text, time, text) from public;
revoke all on function public.create_habit_with_squads(uuid[], text, text, text, time, text) from anon;
grant execute on function public.create_habit_with_squads(uuid[], text, text, text, time, text) to authenticated;

revoke all on function public.update_habit_with_squads(uuid, uuid[], text, text, text, time, text) from public;
revoke all on function public.update_habit_with_squads(uuid, uuid[], text, text, text, time, text) from anon;
grant execute on function public.update_habit_with_squads(uuid, uuid[], text, text, text, time, text) to authenticated;
