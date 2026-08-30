-- Keep RLS-callable friendship helpers from becoming graph-enumeration APIs.
-- Every current caller operates on the authenticated user and one counterpart.

create or replace function private.are_direct_friends(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    first_user = (select auth.uid())
    or second_user = (select auth.uid())
  )
  and first_user is not null
  and second_user is not null
  and first_user <> second_user
  and exists (
    select 1
    from public.friendships friendship
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
  select case
    when friendship.user_a = target_user then friendship.user_b
    else friendship.user_a
  end
  from public.friendships friendship
  where target_user = (select auth.uid())
    and (friendship.user_a = target_user or friendship.user_b = target_user);
$$;

-- Policies and owner-bound RPCs still need these helpers. The auth-bound guards
-- above make unrelated-principal probes fail closed even if called directly.
revoke all on function private.are_direct_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function private.direct_friend_ids(uuid) from public, anon, authenticated;
grant execute on function private.are_direct_friends(uuid, uuid) to authenticated;
grant execute on function private.direct_friend_ids(uuid) to authenticated;
