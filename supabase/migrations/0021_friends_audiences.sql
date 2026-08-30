-- Unified Friends and explicit, immutable proof audiences.
-- Legacy circles remain available for challenge/invite infrastructure, but social
-- visibility is now direct-friend based and every check-in stores its audience.

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

create index if not exists friend_requests_addressee_status_idx
  on public.friend_requests(addressee_id, status, created_at desc);
create index if not exists friend_requests_requester_status_idx
  on public.friend_requests(requester_id, status, created_at desc);
create unique index if not exists friend_requests_one_pending_pair_idx
  on public.friend_requests(least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where status = 'pending';

-- Short friend links are bearer credentials. Store only a one-way digest and
-- keep the table inaccessible through the client Data API; the RPCs below are
-- the only way to mint or redeem a code.
create table if not exists public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  check (expires_at > created_at)
);
create index if not exists friend_invites_inviter_idx on public.friend_invites(inviter_id, created_at desc);
create index if not exists friend_invites_open_idx on public.friend_invites(code_hash, expires_at) where used_at is null;

-- The audience relation is created before helper functions that reference it.
create table if not exists public.check_in_audience_members (
  check_in_id uuid not null references public.check_ins(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (check_in_id, viewer_id)
);
create index if not exists check_in_audience_members_viewer_idx on public.check_in_audience_members(viewer_id, check_in_id);

create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists friendships_user_b_idx on public.friendships(user_b, user_a);

create table if not exists public.friend_labels (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id, label),
  check (owner_id <> friend_id)
);

-- Existing co-members become direct friends. This does not grant access beyond
-- the circle memberships that already existed.
insert into public.friendships(user_a, user_b)
select distinct
  case when first_member.user_id < second_member.user_id then first_member.user_id else second_member.user_id end,
  case when first_member.user_id < second_member.user_id then second_member.user_id else first_member.user_id end
from public.circle_members first_member
join public.circle_members second_member
  on second_member.circle_id = first_member.circle_id
 and second_member.user_id <> first_member.user_id
on conflict (user_a, user_b) do nothing;

alter table public.habits add column if not exists audience text not null default 'selected_friends';
alter table public.habits add column if not exists selected_friend_ids uuid[] not null default '{}';
alter table public.habits drop constraint if exists habits_audience_check;
alter table public.habits add constraint habits_audience_check
  check (audience in ('all_friends', 'selected_friends', 'only_me'));
alter table public.habits drop constraint if exists habits_selected_audience_check;
alter table public.habits add constraint habits_selected_audience_check
  check (audience = 'selected_friends' or cardinality(selected_friend_ids) = 0);

-- Preserve the exact current circle-derived audience for every existing habit,
-- including habits shared into more than one legacy circle.
update public.habits habit
set audience = 'selected_friends',
    selected_friend_ids = coalesce((
      select array_agg(distinct member.user_id order by member.user_id)
      from public.habit_circles share
      join public.circle_members member on member.circle_id = share.circle_id
      where share.habit_id = habit.id and member.user_id <> habit.owner_id
    ), '{}'::uuid[]);

create or replace function private.are_direct_friends(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select first_user is not null
    and second_user is not null
    and first_user <> second_user
    and exists (
      select 1 from public.friendships friendship
      where friendship.user_a = least(first_user, second_user)
        and friendship.user_b = greatest(first_user, second_user)
    );
$$;

create or replace function private.direct_friend_ids(target_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when friendship.user_a = target_user then friendship.user_b else friendship.user_a end
  from public.friendships friendship
  where friendship.user_a = target_user or friendship.user_b = target_user;
$$;

create or replace function private.habit_visible_to_current_user(target_habit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.habits habit
    where habit.id = target_habit
      and (
        habit.owner_id = (select auth.uid())
        or (
          habit.audience = 'all_friends'
          and private.are_direct_friends(habit.owner_id, (select auth.uid()))
        )
        or (
          habit.audience = 'selected_friends'
          and (select auth.uid()) = any(habit.selected_friend_ids)
          and private.are_direct_friends(habit.owner_id, (select auth.uid()))
        )
        -- Keep metadata available for a check-in that already authorized this
        -- viewer, even if the habit's current audience later changes.
        or exists (
          select 1
          from public.check_ins historical_check_in
          join public.check_in_audience_members historical_viewer
            on historical_viewer.check_in_id = historical_check_in.id
          where historical_check_in.habit_id = habit.id
            and historical_viewer.viewer_id = (select auth.uid())
        )
      )
  );
$$;

revoke all on function private.are_direct_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function private.direct_friend_ids(uuid) from public, anon, authenticated;
revoke all on function private.habit_visible_to_current_user(uuid) from public, anon, authenticated;
grant execute on function private.are_direct_friends(uuid, uuid) to authenticated;
grant execute on function private.direct_friend_ids(uuid) to authenticated;
grant execute on function private.habit_visible_to_current_user(uuid) to authenticated;

-- Keep one hidden compatibility workspace for schema that still requires a circle.
create or replace function public.ensure_friends_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  workspace_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  select membership.circle_id into workspace_id
  from public.circle_members membership
  where membership.user_id = actor
  order by membership.joined_at, membership.circle_id
  limit 1;
  if workspace_id is null then
    insert into public.circles(name, owner_id)
    values ('My Friends', actor)
    returning id into workspace_id;
  end if;
  return workspace_id;
end;
$$;
revoke all on function public.ensure_friends_workspace() from public, anon;
grant execute on function public.ensure_friends_workspace() to authenticated;

-- Nudges are deliberately private in the unified network. The compatibility
-- workspace only satisfies the existing non-null circle foreign key; direct
-- friendship, not shared workspace membership, is the authorization boundary.
create or replace function public.send_friend_nudge(target_user_id uuid, target_message text)
returns public.nudges
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  workspace_id uuid;
  clean_message text := pg_catalog.btrim(coalesce(target_message, ''));
  result public.nudges;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = actor then raise exception 'Choose a friend'; end if;
  if not private.are_direct_friends(actor, target_user_id) then raise exception 'Direct friendship required'; end if;
  if pg_catalog.char_length(clean_message) not between 1 and 140 then raise exception 'Nudge must be 1–140 characters'; end if;
  workspace_id := public.ensure_friends_workspace();
  insert into public.nudges(circle_id, from_user_id, to_user_id, message, visibility)
  values (workspace_id, actor, target_user_id, clean_message, 'private')
  returning * into result;
  return result;
end;
$$;
revoke all on function public.send_friend_nudge(uuid, text) from public, anon;
grant execute on function public.send_friend_nudge(uuid, text) to authenticated;

-- The old habit RPC remains compatible. Its selected audience is populated as
-- each legacy share is written, so a newly-created legacy habit cannot become
-- visible to a direct friend from an unrelated circle.
create or replace function private.sync_legacy_habit_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.habits habit
  set selected_friend_ids = (
    select coalesce(array_agg(distinct member.user_id order by member.user_id), '{}'::uuid[])
    from public.habit_circles share
    join public.circle_members member on member.circle_id = share.circle_id
    where share.habit_id = new.habit_id and member.user_id <> habit.owner_id
  )
  where habit.id = new.habit_id and habit.audience = 'selected_friends';
  return new;
end;
$$;
revoke all on function private.sync_legacy_habit_audience() from public, anon, authenticated;
drop trigger if exists sync_legacy_habit_audience on public.habit_circles;
create trigger sync_legacy_habit_audience
after insert on public.habit_circles
for each row execute function private.sync_legacy_habit_audience();

-- Code invites create a friendship directly after redemption; they do not create
-- a pending friend_requests row, so an outstanding request cannot deadlock this flow.
create or replace function public.create_friend_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  random_bytes bytea := extensions.gen_random_bytes(12);
  code text;
  invite public.friend_invites;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select pg_catalog.string_agg(
    pg_catalog.substr('abcdefghijklmnopqrstuvwxyz0123456789', (pg_catalog.get_byte(random_bytes, byte_index) % 36) + 1, 1),
    '' order by byte_index
  ) into code
  from pg_catalog.generate_series(0, 11) as byte_index;
  insert into public.friend_invites(inviter_id, code_hash)
  values (actor, md5(code))
  returning * into invite;
  return jsonb_build_object('code', code, 'expires_at', invite.expires_at);
end;
$$;

create or replace function public.accept_friend_invite(supplied_code text)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  code text := lower(trim(coalesce(supplied_code, '')));
  invite public.friend_invites;
  result public.friendships;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if code !~ '^[a-z0-9]{12}$' then raise exception 'Invalid invite code'; end if;
  select * into invite
  from public.friend_invites
  where code_hash = md5(code)
    and used_at is null
    and expires_at > now()
  for update;
  if invite.id is null then raise exception 'Invalid or expired invite code'; end if;
  if invite.inviter_id = actor then raise exception 'You cannot accept your own invite'; end if;
  if private.are_direct_friends(invite.inviter_id, actor) then raise exception 'You are already friends'; end if;
  insert into public.friendships(user_a, user_b)
  values (least(invite.inviter_id, actor), greatest(invite.inviter_id, actor))
  on conflict (user_a, user_b) do nothing
  returning * into result;
  update public.friend_invites
  set used_at = now(), accepted_by = actor
  where id = invite.id and used_at is null;
  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where status = 'pending'
    and ((requester_id = invite.inviter_id and addressee_id = actor)
      or (requester_id = actor and addressee_id = invite.inviter_id));
  if result.user_a is null then
    select * into result from public.friendships
    where user_a = least(invite.inviter_id, actor)
      and user_b = greatest(invite.inviter_id, actor);
  end if;
  return result;
end;
$$;

revoke all on function public.create_friend_invite() from public, anon;
revoke all on function public.accept_friend_invite(text) from public, anon;
grant execute on function public.create_friend_invite() to authenticated;
grant execute on function public.accept_friend_invite(text) to authenticated;

create or replace function public.invite_friend(target_user_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result public.friend_requests;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = actor then raise exception 'Choose another user'; end if;
  if not exists (select 1 from public.profiles profile where profile.id = target_user_id) then
    raise exception 'User not found';
  end if;
  if private.are_direct_friends(actor, target_user_id) then raise exception 'You are already friends'; end if;
  select * into result
  from public.friend_requests request
  where request.requester_id = actor
    and request.addressee_id = target_user_id
    and request.status = 'pending'
  for update;
  if result.id is not null then return result; end if;
  if exists (
    select 1 from public.friend_requests request
    where request.requester_id = target_user_id
      and request.addressee_id = actor
      and request.status = 'pending'
  ) then raise exception 'This user already invited you'; end if;
  insert into public.friend_requests(requester_id, addressee_id)
  values (actor, target_user_id)
  returning * into result;
  return result;
end;
$$;

create or replace function public.accept_friend(target_request_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  request public.friend_requests;
  result public.friendships;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into request
  from public.friend_requests
  where id = target_request_id and addressee_id = actor and status = 'pending'
  for update;
  if request.id is null then raise exception 'Friend request is not open'; end if;
  insert into public.friendships(user_a, user_b)
  values (least(request.requester_id, request.addressee_id), greatest(request.requester_id, request.addressee_id))
  on conflict (user_a, user_b) do nothing
  returning * into result;
  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where id = request.id;
  if result.user_a is null then
    select * into result from public.friendships
    where user_a = least(request.requester_id, request.addressee_id)
      and user_b = greatest(request.requester_id, request.addressee_id);
  end if;
  return result;
end;
$$;

create or replace function public.remove_friend(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_user_id is null or target_user_id = actor then raise exception 'Choose another user'; end if;

  delete from public.friendships
  where user_a = least(actor, target_user_id)
    and user_b = greatest(actor, target_user_id);
  if not found then raise exception 'Friendship not found'; end if;

  -- Stop future selected-audience sharing in both directions. Historical
  -- check-in snapshots are intentionally untouched.
  update public.habits
  set selected_friend_ids = array_remove(selected_friend_ids, target_user_id),
      updated_at = now()
  where owner_id = actor and audience = 'selected_friends';
  update public.habits
  set selected_friend_ids = array_remove(selected_friend_ids, actor),
      updated_at = now()
  where owner_id = target_user_id and audience = 'selected_friends';

  update public.friend_requests
  set status = 'cancelled', responded_at = now()
  where status = 'pending'
    and ((requester_id = actor and addressee_id = target_user_id)
      or (requester_id = target_user_id and addressee_id = actor));
  delete from public.friend_labels
  where (owner_id = actor and friend_id = target_user_id)
    or (owner_id = target_user_id and friend_id = actor);
end;
$$;

create or replace function public.set_habit_audience(
  target_habit_id uuid,
  requested_audience text,
  requested_friend_ids uuid[] default '{}'
)
returns public.habits
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result public.habits;
  selected uuid[] := coalesce(requested_friend_ids, '{}');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if requested_audience not in ('all_friends', 'selected_friends', 'only_me') then
    raise exception 'Unsupported habit audience';
  end if;
  if cardinality(selected) <> cardinality(array(select distinct id from unnest(selected) id)) then
    raise exception 'Duplicate selected friends are not allowed';
  end if;
  if requested_audience <> 'selected_friends' and cardinality(selected) > 0 then
    raise exception 'Only selected-friends audience accepts friend ids';
  end if;
  if exists (
    select 1 from unnest(selected) requested(id)
    where requested.id = actor or not private.are_direct_friends(actor, requested.id)
  ) then raise exception 'Selected audience may contain direct friends only'; end if;
  update public.habits
  set audience = requested_audience,
      selected_friend_ids = case when requested_audience = 'selected_friends' then selected else '{}'::uuid[] end,
      updated_at = now()
  where id = target_habit_id and owner_id = actor
  returning * into result;
  if result.id is null then raise exception 'Habit not found or not owned by you'; end if;
  return result;
end;
$$;

revoke all on function public.invite_friend(uuid) from public, anon;
revoke all on function public.accept_friend(uuid) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.set_habit_audience(uuid, text, uuid[]) from public, anon;
grant execute on function public.invite_friend(uuid) to authenticated;
grant execute on function public.accept_friend(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.set_habit_audience(uuid, text, uuid[]) to authenticated;

-- Every check-in stores the exact viewer set at insert time. Later friendship
-- changes therefore cannot expose historical proof or social interactions.
insert into public.check_in_audience_members(check_in_id, viewer_id)
select check_in.id, check_in.user_id
from public.check_ins check_in
on conflict (check_in_id, viewer_id) do nothing;
-- Legacy share timestamps created by the migration are not evidence of when an
-- old share happened. Requiring them to precede completion therefore fails
-- closed for unverifiable legacy timing and retains owner-only access.
insert into public.check_in_audience_members(check_in_id, viewer_id)
select distinct check_in.id, member.user_id
from public.check_ins check_in
join public.habits habit on habit.id = check_in.habit_id
join public.habit_circles share on share.habit_id = habit.id
join public.circle_members member on member.circle_id = share.circle_id
where member.user_id <> check_in.user_id
  and member.joined_at <= check_in.completed_at
  and share.shared_at <= check_in.completed_at
  and (
    habit.audience = 'all_friends'
    or (habit.audience = 'selected_friends' and member.user_id = any(habit.selected_friend_ids))
  )
on conflict (check_in_id, viewer_id) do nothing;

-- Rejection thresholds use only the immutable snapshot, never the current
-- circle membership (which may include people who were not authorized then).
create or replace function private.valid_baton_check_in(target_check_in uuid, expected_user uuid, expected_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.check_ins check_in
    join public.habits habit on habit.id = check_in.habit_id
    where check_in.id = target_check_in
      and check_in.user_id = expected_user
      and check_in.completed_at is not null
      and habit.circle_id = expected_circle
      and (
        check_in.proof_path is null
        or (
          select count(distinct reaction.user_id)
          from public.reactions reaction
          join public.check_in_audience_members viewer
            on viewer.check_in_id = check_in.id and reaction.user_id = viewer.viewer_id
          where reaction.check_in_id = check_in.id
            and reaction.emoji = '👎'
            and reaction.user_id <> check_in.user_id
        ) < floor(((
          select count(*) from public.check_in_audience_members viewer
          where viewer.check_in_id = check_in.id and viewer.viewer_id <> check_in.user_id
        )::numeric) / 2) + 1
      )
  );
$$;
revoke all on function private.valid_baton_check_in(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.snapshot_check_in_audience_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  habit public.habits;
  viewer uuid;
begin
  select * into habit from public.habits where id = new.habit_id;
  if habit.id is null then raise exception 'Habit not found'; end if;
  insert into public.check_in_audience_members(check_in_id, viewer_id) values (new.id, new.user_id)
  on conflict do nothing;
  if habit.audience = 'all_friends' then
    insert into public.check_in_audience_members(check_in_id, viewer_id)
    select new.id, private.direct_friend_ids(habit.owner_id)
    on conflict do nothing;
  elsif habit.audience = 'selected_friends' then
    insert into public.check_in_audience_members(check_in_id, viewer_id)
    select new.id, viewer
    from unnest(habit.selected_friend_ids) selected(viewer)
    where private.are_direct_friends(habit.owner_id, viewer)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_check_in_audience_members() from public, anon, authenticated;
drop trigger if exists snapshot_check_in_audience_members on public.check_ins;
create trigger snapshot_check_in_audience_members
  after insert on public.check_ins
  for each row execute function private.snapshot_check_in_audience_members();

-- Return only immutable audience cardinalities for visible check-ins. The
-- member rows themselves remain self-select-only so this cannot enumerate a
-- proof's audience.
create or replace function public.check_in_audience_sizes(target_check_in_ids uuid[])
returns table(check_in_id uuid, audience_size bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select audience.check_in_id, count(*)::bigint
  from public.check_in_audience_members audience
  where audience.check_in_id = any(coalesce(target_check_in_ids, '{}'::uuid[]))
    and exists (
      select 1
      from public.check_in_audience_members viewer
      where viewer.check_in_id = audience.check_in_id
        and viewer.viewer_id = (select auth.uid())
    )
  group by audience.check_in_id;
$$;
revoke all on function public.check_in_audience_sizes(uuid[]) from public, anon;
grant execute on function public.check_in_audience_sizes(uuid[]) to authenticated;

-- Replace circle-derived reads with the immutable viewer snapshot.
drop policy if exists profiles_select_circle_peers on public.profiles;
drop policy if exists profiles_select_friends on public.profiles;
create policy profiles_select_friends
on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.are_direct_friends(id, (select auth.uid())));

drop policy if exists habits_select_shared on public.habits;
drop policy if exists habits_select_circle_members on public.habits;
create policy habits_select_explicit_audience
on public.habits for select to authenticated
using (private.habit_visible_to_current_user(id));

drop policy if exists check_ins_select_shared on public.check_ins;
drop policy if exists check_ins_select_circle_members on public.check_ins;
create policy check_ins_select_snapshotted_viewer
on public.check_ins for select to authenticated
using (exists (
  select 1 from public.check_in_audience_members viewer
  where viewer.check_in_id = check_ins.id and viewer.viewer_id = (select auth.uid())
));

drop policy if exists check_ins_insert_self on public.check_ins;
drop policy if exists check_ins_update_self on public.check_ins;
drop policy if exists check_ins_insert_owner_current_day on public.check_ins;
create policy check_ins_insert_owner_current_day
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
  and check_date = (select private.current_user_date())
  and exists (
    select 1 from public.habits habit
    where habit.id = check_ins.habit_id
      and habit.owner_id = (select auth.uid())
      and habit.active
      and (
        (habit.proof_mode = 'none' and proof_path is null)
        or (
          habit.proof_mode = 'photo'
          and proof_path is not null
          and proof_path like ((select auth.uid())::text || '/' || check_ins.habit_id::text || '-%')
          and private.proof_object_exists(proof_path)
        )
      )
  )
);

drop policy if exists check_ins_delete_self on public.check_ins;
drop policy if exists check_ins_delete_active_self on public.check_ins;
create policy check_ins_delete_owner
on public.check_ins for delete to authenticated
using (user_id = (select auth.uid()));
revoke update on public.check_ins from authenticated;

-- Storage is private and bound to the exact check-in snapshot, not to the
-- uploader's folder or to any unrelated shared circle.
create or replace function private.can_view_proof(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.check_ins check_in
    join public.check_in_audience_members viewer on viewer.check_in_id = check_in.id
    where check_in.proof_path = target_path
      and viewer.viewer_id = (select auth.uid())
  )
  or (
    split_part(target_path, '/', 1) = (select auth.uid())::text
    and private.proof_is_unbound(target_path)
  );
$$;

drop policy if exists proof_objects_select_exact_circle on storage.objects;
drop policy if exists proof_objects_select_circle_peers on storage.objects;
create policy proof_objects_select_authorized_viewer
on storage.objects for select to authenticated
using (bucket_id = 'proofs' and private.can_view_proof(name));

drop policy if exists reactions_select_shared on public.reactions;
drop policy if exists reactions_select_visible_checkins on public.reactions;
drop policy if exists reactions_select_circle_checkins on public.reactions;
create policy reactions_select_authorized_viewer
on public.reactions for select to authenticated
using (exists (
  select 1 from public.check_in_audience_members viewer
  where viewer.check_in_id = reactions.check_in_id and viewer.viewer_id = (select auth.uid())
));

drop policy if exists reactions_insert_self on public.reactions;
create policy reactions_insert_authorized_self
on public.reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.check_in_audience_members viewer
    where viewer.check_in_id = reactions.check_in_id and viewer.viewer_id = (select auth.uid())
  )
  and (
    emoji <> '👎'
    or exists (select 1 from public.check_ins check_in where check_in.id = reactions.check_in_id and check_in.proof_path is not null and check_in.user_id <> (select auth.uid()))
  )
);

drop policy if exists reactions_delete_self on public.reactions;
create policy reactions_delete_authorized_self
on public.reactions for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.check_in_audience_members viewer
    where viewer.check_in_id = reactions.check_in_id and viewer.viewer_id = (select auth.uid())
  )
);

-- Flat replies are visible to every viewer snapshotted for the proof.
alter table public.check_in_comments alter column circle_id drop not null;

create or replace function private.lock_comment_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.check_in_id is distinct from old.check_in_id
      or new.circle_id is distinct from old.circle_id
      or new.author_id is distinct from old.author_id
      or new.body is distinct from old.body
      or new.created_at is distinct from old.created_at then
      raise exception 'Comments are immutable';
    end if;
  end if;
  if not exists (select 1 from public.check_ins check_in where check_in.id = new.check_in_id) then
    raise exception 'Comment check-in does not exist';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_comment_scope() from public, anon, authenticated;
drop trigger if exists lock_comment_scope on public.check_in_comments;
create trigger lock_comment_scope
before insert or update on public.check_in_comments
for each row execute function private.lock_comment_scope();

drop policy if exists check_in_comments_select_circle_members on public.check_in_comments;
create policy check_in_comments_select_authorized_viewer
on public.check_in_comments for select to authenticated
using (exists (
  select 1 from public.check_in_audience_members viewer
  where viewer.check_in_id = check_in_comments.check_in_id and viewer.viewer_id = (select auth.uid())
));

create or replace function public.add_check_in_comment(target_check_in_id uuid, comment_body text)
returns public.check_in_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result public.check_in_comments;
  clean_body text := btrim(comment_body);
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if clean_body is null or char_length(clean_body) not between 1 and 180 then raise exception 'Comment must be 1–180 characters'; end if;
  if not exists (
    select 1 from public.check_in_audience_members viewer
    where viewer.check_in_id = target_check_in_id and viewer.viewer_id = actor
  ) then raise exception 'Check-in is not visible to you'; end if;
  insert into public.check_in_comments(check_in_id, circle_id, author_id, body)
  values (target_check_in_id, null, actor, clean_body)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.add_check_in_comment(uuid, text) from public, anon;
grant execute on function public.add_check_in_comment(uuid, text) to authenticated;

create or replace function public.delete_check_in_comment(target_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  deleted_count integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  delete from public.check_in_comments reply
  where reply.id = target_comment_id
    and reply.author_id = actor
    and exists (
      select 1 from public.check_in_audience_members viewer
      where viewer.check_in_id = reply.check_in_id and viewer.viewer_id = actor
    )
  returning 1 into deleted_count;
  if deleted_count is null then raise exception 'Only an authorized author can delete this reply'; end if;
  return true;
end;
$$;
revoke all on function public.delete_check_in_comment(uuid) from public, anon;
grant execute on function public.delete_check_in_comment(uuid) to authenticated;
revoke insert, update, delete on public.check_in_comments from authenticated;
revoke insert, update, delete on public.check_in_audience_members from authenticated;
grant select on public.friendships, public.friend_requests, public.friend_labels, public.check_in_audience_members to authenticated;
grant select on public.friendships to service_role;
revoke all on public.friend_invites from public, anon, authenticated;

drop policy if exists nudges_select_sender_or_recipient on public.nudges;
drop policy if exists nudges_select_by_visibility on public.nudges;
drop policy if exists nudges_insert_sender on public.nudges;
create policy nudges_select_sender_or_recipient
on public.nudges for select to authenticated
using (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()));
revoke insert on table public.nudges from authenticated;

-- Re-state the critical RLS boundary in the unified-network migration so a
-- fresh deployment and an incremental deployment have the same guardrail.
alter table public.profiles enable row level security;
alter table public.habits enable row level security;
alter table public.check_ins enable row level security;
alter table public.reactions enable row level security;
alter table public.check_in_comments enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friend_invites enable row level security;
alter table public.friend_labels enable row level security;
alter table public.check_in_audience_members enable row level security;

create policy friendships_select_self on public.friendships
for select to authenticated using (user_a = (select auth.uid()) or user_b = (select auth.uid()));
create policy friend_requests_select_participant on public.friend_requests
for select to authenticated using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));
create policy friend_labels_owner on public.friend_labels
for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and private.are_direct_friends(owner_id, friend_id));
create policy check_in_audience_members_select_self on public.check_in_audience_members
for select to authenticated using (viewer_id = (select auth.uid()));
