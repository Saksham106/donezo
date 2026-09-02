-- Fix selected-friends proof uploads failing with:
--   column reference "viewer" is ambiguous
-- The previous trigger used `viewer` as both a PL/pgSQL variable and an
-- unnested SQL column name. Keep the same audience semantics with an explicit
-- SQL identifier instead.

create or replace function private.snapshot_check_in_audience_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  habit public.habits;
begin
  select * into habit from public.habits where id = new.habit_id;
  if habit.id is null then raise exception 'Habit not found'; end if;

  insert into public.check_in_audience_members(check_in_id, viewer_id)
  values (new.id, new.user_id)
  on conflict do nothing;

  if habit.audience = 'all_friends' then
    insert into public.check_in_audience_members(check_in_id, viewer_id)
    select new.id, private.direct_friend_ids(habit.owner_id)
    on conflict do nothing;
  elsif habit.audience = 'selected_friends' then
    insert into public.check_in_audience_members(check_in_id, viewer_id)
    select new.id, selected_viewer_id
    from unnest(habit.selected_friend_ids) as selected_friend(selected_viewer_id)
    where private.are_direct_friends(habit.owner_id, selected_viewer_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.snapshot_check_in_audience_members() from public, anon, authenticated;
