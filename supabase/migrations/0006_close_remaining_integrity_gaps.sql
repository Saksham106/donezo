-- Check-ins only represent the authenticated user's current local day.
create or replace function private.current_user_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = auth.uid()),
    'UTC'
  ))::date;
$$;

revoke all on function private.current_user_date() from public, anon, authenticated;
grant execute on function private.current_user_date() to authenticated;

drop policy if exists check_ins_insert_self on public.check_ins;
create policy check_ins_insert_self
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
  and check_date = (select private.current_user_date())
  and exists (
    select 1
    from public.habits h
    where h.id = habit_id
      and h.owner_id = (select auth.uid())
      and h.active
      and h.circle_id in (select private.user_circle_ids())
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

-- Joining must go through the invite-code RPC. Direct membership inserts are
-- reserved for circle owners; the security-definer RPC performs peer joins.
drop policy if exists circle_members_insert_self_or_owner on public.circle_members;
create policy circle_members_insert_owner
on public.circle_members for insert to authenticated
with check ((select private.is_circle_owner(circle_id)));

-- Nudges are immutable social records. The current client does not mark them
-- read yet, so remove broad recipient UPDATE access rather than allowing sender
-- or circle forgery through a row rewrite.
drop policy if exists nudges_update_recipient on public.nudges;
revoke update on public.nudges from authenticated;
