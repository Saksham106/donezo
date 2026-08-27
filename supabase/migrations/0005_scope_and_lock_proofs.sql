-- Scope proof reads to the exact check-in circle and make submitted evidence
-- immutable until its check-in is deleted.
create or replace function private.can_view_proof(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    split_part(target_path, '/', 1) = (select auth.uid())::text
    or exists (
      select 1
      from public.check_ins ci
      join public.habits h on h.id = ci.habit_id
      join public.circle_members cm on cm.circle_id = h.circle_id
      where ci.proof_path = target_path
        and cm.user_id = (select auth.uid())
    );
$$;

create or replace function private.proof_is_unbound(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.check_ins ci
    where ci.proof_path = target_path
  );
$$;

revoke all on function private.can_view_proof(text) from public, anon, authenticated;
revoke all on function private.proof_is_unbound(text) from public, anon, authenticated;
grant execute on function private.can_view_proof(text) to authenticated;
grant execute on function private.proof_is_unbound(text) to authenticated;

drop policy if exists proof_objects_select_circle_peers on storage.objects;
create policy proof_objects_select_exact_circle
on storage.objects for select to authenticated
using (
  bucket_id = 'proofs'
  and (select private.can_view_proof(name))
);

-- Proofs are append-only. The client deliberately deletes the check-in first;
-- only then may it remove the now-unbound object during an undo.
drop policy if exists proof_objects_update_self on storage.objects;
drop policy if exists proof_objects_delete_self on storage.objects;
create policy proof_objects_delete_unbound_self
on storage.objects for delete to authenticated
using (
  bucket_id = 'proofs'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and (select private.proof_is_unbound(name))
);
