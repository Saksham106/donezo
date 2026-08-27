-- The current product has no circle switcher, so enforce its one-circle MVP
-- invariant instead of accepting memberships the UI cannot reach.
create unique index circle_members_one_circle_per_user
on public.circle_members(user_id);

-- Removed members retain historical read access only through the remaining
-- circle's policies; they may not destructively rewrite shared history.
drop policy if exists habits_delete_owner on public.habits;
create policy habits_delete_active_owner
on public.habits for delete to authenticated
using (
  owner_id = (select auth.uid())
  and circle_id in (select private.user_circle_ids())
);

drop policy if exists check_ins_delete_self on public.check_ins;
create policy check_ins_delete_active_self
on public.check_ins for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.habits h
    where h.id = habit_id
      and h.circle_id in (select private.user_circle_ids())
  )
);
