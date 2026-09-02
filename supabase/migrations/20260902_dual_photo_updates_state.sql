-- BeReal-style dual-photo proofs remain a single proof object, and the top-right
-- social inbox gains a private server-authoritative high-water mark.

alter table public.habits
  drop constraint if exists habits_proof_mode_check;
alter table public.habits
  add constraint habits_proof_mode_check
  check (proof_mode in ('none', 'photo', 'dual_photo'));

-- Keep the current friend/audience insert rules, but make the business rule
-- future-proof: every non-none proof mode must bind to an uploaded proof.
drop policy if exists check_ins_insert_owner_current_day on public.check_ins;
create policy check_ins_insert_owner_current_day
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
  and check_date = (select private.current_user_date())
  and exists (
    select 1
    from public.habits h
    where h.id = check_ins.habit_id
      and h.owner_id = (select auth.uid())
      and h.active
      and (
        (h.proof_mode = 'none' and proof_path is null)
        or (
          h.proof_mode <> 'none'
          and proof_path is not null
          and proof_path like ((select auth.uid())::text || '/' || check_ins.habit_id::text || '-%')
          and private.proof_object_exists(proof_path)
        )
      )
  )
);

create table if not exists public.user_update_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_update_state enable row level security;

revoke all on table public.user_update_state from public, anon;
grant select, insert, update on table public.user_update_state to authenticated;

drop policy if exists user_update_state_select_self on public.user_update_state;
create policy user_update_state_select_self
on public.user_update_state for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_update_state_insert_self on public.user_update_state;
create policy user_update_state_insert_self
on public.user_update_state for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_update_state_update_self on public.user_update_state;
create policy user_update_state_update_self
on public.user_update_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.mark_updates_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  marked_at timestamptz := clock_timestamp();
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  update public.nudges
  set read_at = marked_at
  where to_user_id = actor
    and read_at is null;

  insert into public.user_update_state(user_id, last_seen_at, updated_at)
  values (actor, marked_at, marked_at)
  on conflict (user_id) do update
  set last_seen_at = greatest(public.user_update_state.last_seen_at, excluded.last_seen_at),
      updated_at = excluded.updated_at;

  return marked_at;
end;
$$;

revoke all on function public.mark_updates_seen() from public, anon;
grant execute on function public.mark_updates_seen() to authenticated;
