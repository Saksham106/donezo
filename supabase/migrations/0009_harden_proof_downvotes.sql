-- Proof downvotes are visible only inside the voter's circle and users cannot
-- downvote their own proof. The app uses emoji 👎 as the proof-rejection vote.

drop policy if exists reactions_select_visible_checkins on public.reactions;
drop policy if exists reactions_insert_self on public.reactions;
drop policy if exists reactions_delete_self on public.reactions;

create policy reactions_select_circle_checkins
on public.reactions for select to authenticated
using (
  exists (
    select 1
    from public.check_ins ci
    join public.habits h on h.id = ci.habit_id
    where ci.id = check_in_id
      and h.circle_id in (select private.user_circle_ids())
  )
);

create policy reactions_insert_circle_peer
on public.reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.check_ins ci
    join public.habits h on h.id = ci.habit_id
    where ci.id = check_in_id
      and h.circle_id in (select private.user_circle_ids())
      and (emoji <> '👎' or ci.user_id <> (select auth.uid()))
  )
);

create policy reactions_delete_self
on public.reactions for delete to authenticated
using (user_id = (select auth.uid()));

create index if not exists reactions_user_id_idx on public.reactions(user_id);
