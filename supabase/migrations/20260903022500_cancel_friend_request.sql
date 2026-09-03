create or replace function public.cancel_friend_request(target_request_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.friend_requests;
begin
  if actor is null then raise exception 'Authentication required'; end if;

  select * into target
  from public.friend_requests request
  where request.id = target_request_id
    and request.requester_id = actor
    and request.status = 'pending'
  for update;

  if target.id is null then raise exception 'Friend request is not open'; end if;

  update public.friend_requests request
  set status = 'cancelled',
      responded_at = now()
  where request.id = target.id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.cancel_friend_request(uuid) from public, anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
