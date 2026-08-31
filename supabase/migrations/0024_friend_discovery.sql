-- Keep server-side storage validation aligned with every format accepted by
-- iPhone and browser camera-roll pickers.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'proofs';

-- Let request participants identify each other without exposing the wider graph.
drop policy if exists profiles_select_friends on public.profiles;
drop policy if exists profiles_select_friends_or_requests on public.profiles;
create policy profiles_select_friends_or_requests
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or private.are_direct_friends(id, (select auth.uid()))
  or exists (
    select 1
    from public.friend_requests request
    where request.status = 'pending'
      and (
        (request.requester_id = id and request.addressee_id = (select auth.uid()))
        or (request.addressee_id = id and request.requester_id = (select auth.uid()))
      )
  )
);

-- A user may inspect one direct friend's connections. This is discovery only:
-- it returns compact profile data and request state, never social activity.
create or replace function public.list_friend_connections(target_friend_id uuid)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if target_friend_id is null or not private.are_direct_friends(actor, target_friend_id) then
    raise exception 'Direct friendship required';
  end if;

  return query
  with candidates as (
    select case
      when friendship.user_a = target_friend_id then friendship.user_b
      else friendship.user_a
    end as candidate_id
    from public.friendships friendship
    where friendship.user_a = target_friend_id or friendship.user_b = target_friend_id
  )
  select
    profile.id,
    profile.username,
    profile.display_name,
    profile.avatar_url,
    case
      when private.are_direct_friends(actor, profile.id) then 'friend'
      when pending.requester_id = profile.id then 'incoming'
      when pending.requester_id = actor then 'outgoing'
      else 'available'
    end,
    pending.id,
    (
      select count(*)
      from (
        select case when mine.user_a = actor then mine.user_b else mine.user_a end as shared_id
        from public.friendships mine
        where mine.user_a = actor or mine.user_b = actor
        intersect
        select case when theirs.user_a = profile.id then theirs.user_b else theirs.user_a end as shared_id
        from public.friendships theirs
        where theirs.user_a = profile.id or theirs.user_b = profile.id
      ) mutual
    )
  from candidates candidate
  join public.profiles profile on profile.id = candidate.candidate_id
  left join lateral (
    select request.*
    from public.friend_requests request
    where request.status = 'pending'
      and (
        (request.requester_id = actor and request.addressee_id = profile.id)
        or (request.requester_id = profile.id and request.addressee_id = actor)
      )
    order by request.created_at desc
    limit 1
  ) pending on true
  where profile.id <> actor
  order by profile.display_name, profile.id;
end;
$$;

revoke all on function public.list_friend_connections(uuid) from public, anon;
grant execute on function public.list_friend_connections(uuid) to authenticated;
