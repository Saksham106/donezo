-- Raise new direct-friend invite entropy from the legacy short-code format to
-- 96 random bits. Existing unredeemed 12-character invites remain valid.
create or replace function public.create_friend_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  code text := encode(extensions.gen_random_bytes(12), 'hex');
  invite public.friend_invites;
begin
  if actor is null then raise exception 'Authentication required'; end if;
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
  if code !~ '^([a-z0-9]{12}|[a-f0-9]{24})$' then raise exception 'Invalid invite code'; end if;
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