-- Join circles by the short invite code without exposing circle rows.
create or replace function public.join_circle(supplied_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_circle_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select c.id into target_circle_id
  from public.circles c
  where c.invite_code = lower(trim(supplied_code));

  if target_circle_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.circle_members(circle_id, user_id, role)
  values (target_circle_id, current_user_id, 'member')
  on conflict (circle_id, user_id) do nothing;

  return target_circle_id;
end;
$$;

revoke all on function public.join_circle(text) from public, anon;
grant execute on function public.join_circle(text) to authenticated;

-- Cover the remaining foreign keys reported by Supabase's performance advisor.
create index circles_owner_id_idx on public.circles(owner_id);
create index nudges_from_user_id_idx on public.nudges(from_user_id);
create index reactions_user_id_idx on public.reactions(user_id);
