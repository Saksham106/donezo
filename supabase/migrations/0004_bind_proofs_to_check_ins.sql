-- Proof-bearing check-ins must reference a real, one-time object uploaded for
-- that exact habit. The helper is private so Storage rows stay unexposed.
create or replace function private.proof_object_exists(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'proofs' and o.name = target_path
  );
$$;

revoke all on function private.proof_object_exists(text) from public, anon, authenticated;
grant execute on function private.proof_object_exists(text) to authenticated;

create unique index check_ins_proof_path_unique
on public.check_ins(proof_path)
where proof_path is not null;

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
          and proof_path like ((select auth.uid())::text || '/' || habit_id::text || '-%')
          and (select private.proof_object_exists(proof_path))
        )
      )
  )
);
