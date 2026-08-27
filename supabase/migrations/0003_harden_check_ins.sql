-- Check-ins are append/delete records in the current product. Prevent clients
-- from retargeting an existing completion to another habit or proof object.
drop policy if exists check_ins_update_self on public.check_ins;
revoke update on public.check_ins from authenticated;

-- A completion must belong to the authenticated user's active habit in a
-- circle they still belong to. Photo-required habits must point inside that
-- same user's private Storage folder.
drop policy if exists check_ins_insert_self on public.check_ins;
create policy check_ins_insert_self
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
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
          and split_part(proof_path, '/', 1) = (select auth.uid())::text
        )
      )
  )
);
