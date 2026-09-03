-- Give every Donezo account a stable public username while keeping profile
-- rows private behind existing RLS. Discovery is exposed only through bounded
-- SECURITY DEFINER RPCs below.

create or replace function private.normalize_donezo_username(raw_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    trim(both '._' from regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9._]+', '_', 'g')),
    ''
  );
$$;

create or replace function private.generated_donezo_username(target_display_name text, target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text := replace(target_user_id::text, '-', '');
  suffix_length integer := 6;
begin
  base := coalesce(private.normalize_donezo_username(target_display_name), 'user');
  if base !~ '^[a-z0-9]' then
    base := 'user_' || base;
  end if;
  base := left(base, 30);
  if length(base) < 3 then
    base := rpad(base, 3, '0');
  end if;

  candidate := base;
  while candidate in ('admin', 'administrator', 'donezo', 'support', 'system')
    or exists (
      select 1
      from public.profiles existing_profile
      where existing_profile.username = candidate
        and existing_profile.id <> target_user_id
    )
  loop
    candidate := left(base, greatest(1, 30 - suffix_length - 1)) || '_' || left(suffix, suffix_length);
    suffix_length := least(20, suffix_length + 2);
  end loop;

  return candidate;
end;
$$;

-- Backfill row-by-row so two existing users with the same display name cannot
-- both select the same readable base before the uniqueness check sees it.
do $$
declare
  target_profile record;
begin
  for target_profile in
    select profile.id, profile.display_name
    from public.profiles profile
    where profile.username is null or btrim(profile.username) = ''
    order by profile.created_at, profile.id
  loop
    update public.profiles profile
    set username = private.generated_donezo_username(target_profile.display_name, target_profile.id)
    where profile.id = target_profile.id;
  end loop;
end;
$$;

create or replace function private.assign_donezo_profile_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := private.generated_donezo_username(new.display_name, new.id);
  else
    new.username := private.normalize_donezo_username(new.username);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_username on public.profiles;
create trigger profiles_assign_username
before insert on public.profiles
for each row execute function private.assign_donezo_profile_username();

alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (
    username ~ '^[a-z0-9][a-z0-9._]{2,29}$'
    and username not in ('admin', 'administrator', 'donezo', 'support', 'system')
  );

alter table public.profiles
  alter column username set not null;

-- Preserve/enforce normalized username uniqueness even on databases where the
-- original profiles_username_key constraint was not installed.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.contype = 'u'
      and constraint_row.conname = 'profiles_username_key'
  ) then
    alter table public.profiles add constraint profiles_username_key unique (username);
  end if;
end;
$$;

-- Repair the request-participant branch from 0024. The old unqualified `id`
-- was resolved as request.id inside the subquery instead of the outer profile.
drop policy if exists profiles_select_friends_or_requests on public.profiles;
create policy profiles_select_friends_or_requests
on public.profiles for select to authenticated
using (
  profiles.id = (select auth.uid())
  or private.are_direct_friends(profiles.id, (select auth.uid()))
  or exists (
    select 1
    from public.friend_requests request
    where request.status = 'pending'
      and (
        (request.requester_id = profiles.id and request.addressee_id = (select auth.uid()))
        or (request.addressee_id = profiles.id and request.requester_id = (select auth.uid()))
      )
  )
);

create or replace function public.set_my_username(desired_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized text := private.normalize_donezo_username(desired_username);
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  if normalized is null or normalized !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'Username must be 3-30 characters using letters, numbers, dots, or underscores';
  end if;
  if normalized in ('admin', 'administrator', 'donezo', 'support', 'system') then
    raise exception 'Username is reserved';
  end if;
  if exists (
    select 1
    from public.profiles profile
    where profile.username = normalized
      and profile.id <> actor
  ) then
    raise exception 'Username is taken';
  end if;

  update public.profiles profile
  set username = normalized,
      updated_at = now()
  where profile.id = actor;

  return normalized;
exception
  when unique_violation then
    raise exception 'Username is taken';
end;
$$;

create or replace function public.search_people(search_query text, result_limit integer default 20)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  relationship_status text,
  request_id uuid,
  mutual_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_query text := lower(btrim(coalesce(search_query, '')));
  bounded_limit integer := greatest(1, least(20, coalesce(result_limit, 20)));
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  if left(normalized_query, 1) = '@' then
    normalized_query := substr(normalized_query, 2);
  end if;
  normalized_query := btrim(normalized_query);

  if length(normalized_query) < 2 then
    return;
  end if;

  return query
  select
    profile.id as user_id,
    profile.username,
    profile.display_name,
    profile.avatar_url,
    case
      when private.are_direct_friends(actor, profile.id) then 'friend'
      when pending.requester_id = profile.id then 'incoming'
      when pending.requester_id = actor then 'outgoing'
      else 'available'
    end as relationship_status,
    pending.id as request_id,
    mutual.count as mutual_count
  from public.profiles profile
  left join lateral (
    select request.id, request.requester_id, request.addressee_id
    from public.friend_requests request
    where request.status = 'pending'
      and (
        (request.requester_id = actor and request.addressee_id = profile.id)
        or (request.requester_id = profile.id and request.addressee_id = actor)
      )
    order by request.created_at desc, request.id
    limit 1
  ) pending on true
  cross join lateral (
    select count(*)::bigint as count
    from (
      select case when mine.user_a = actor then mine.user_b else mine.user_a end as shared_id
      from public.friendships mine
      where mine.user_a = actor or mine.user_b = actor
      intersect
      select case when theirs.user_a = profile.id then theirs.user_b else theirs.user_a end as shared_id
      from public.friendships theirs
      where theirs.user_a = profile.id or theirs.user_b = profile.id
    ) shared_friends
  ) mutual
  where profile.id <> actor
    and (
      profile.username = normalized_query
      or starts_with(profile.username, normalized_query)
      or starts_with(lower(profile.display_name), normalized_query)
      or position(normalized_query in lower(profile.display_name)) > 0
    )
  order by
    case
      when profile.username = normalized_query then 0
      when starts_with(profile.username, normalized_query) then 1
      when starts_with(lower(profile.display_name), normalized_query) then 2
      else 3
    end,
    mutual.count desc,
    lower(profile.display_name),
    profile.id
  limit bounded_limit;
end;
$$;

create or replace function public.suggest_people(result_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  relationship_status text,
  request_id uuid,
  mutual_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  bounded_limit integer := greatest(1, least(20, coalesce(result_limit, 10)));
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    profile.id as user_id,
    profile.username,
    profile.display_name,
    profile.avatar_url,
    case
      when pending.requester_id = profile.id then 'incoming'
      when pending.requester_id = actor then 'outgoing'
      else 'available'
    end as relationship_status,
    pending.id as request_id,
    mutual.count as mutual_count
  from public.profiles profile
  left join lateral (
    select request.id, request.requester_id, request.addressee_id
    from public.friend_requests request
    where request.status = 'pending'
      and (
        (request.requester_id = actor and request.addressee_id = profile.id)
        or (request.requester_id = profile.id and request.addressee_id = actor)
      )
    order by request.created_at desc, request.id
    limit 1
  ) pending on true
  cross join lateral (
    select count(*)::bigint as count
    from (
      select case when mine.user_a = actor then mine.user_b else mine.user_a end as shared_id
      from public.friendships mine
      where mine.user_a = actor or mine.user_b = actor
      intersect
      select case when theirs.user_a = profile.id then theirs.user_b else theirs.user_a end as shared_id
      from public.friendships theirs
      where theirs.user_a = profile.id or theirs.user_b = profile.id
    ) shared_friends
  ) mutual
  where profile.id <> actor
    and not private.are_direct_friends(actor, profile.id)
    and mutual.count > 0
  order by mutual.count desc, lower(profile.display_name), profile.id
  limit bounded_limit;
end;
$$;

revoke all on function public.set_my_username(text) from public, anon;
revoke all on function public.search_people(text, integer) from public, anon;
revoke all on function public.suggest_people(integer) from public, anon;

grant execute on function public.set_my_username(text) to authenticated;
grant execute on function public.search_people(text, integer) to authenticated;
grant execute on function public.suggest_people(integer) to authenticated;
