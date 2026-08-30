-- Keep optional challenge-backed stakes inside one squad.

create or replace function private.enforce_stake_challenge_circle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.challenge_id is not null and not exists (
    select 1
    from public.weekly_challenges challenge
    where challenge.id = new.challenge_id
      and challenge.circle_id = new.circle_id
  ) then
    raise exception 'Stake challenge must belong to the same squad';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_stake_challenge_circle() from public, anon, authenticated;

drop trigger if exists enforce_stake_challenge_circle on public.group_stakes;
create trigger enforce_stake_challenge_circle
  before insert or update of circle_id, challenge_id on public.group_stakes
  for each row execute function private.enforce_stake_challenge_circle();

drop policy if exists group_stakes_insert_members on public.group_stakes;
create policy group_stakes_insert_members on public.group_stakes
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and circle_id in (select private.user_circle_ids())
  and status = 'pending'
  and (
    challenge_id is null or exists (
      select 1
      from public.weekly_challenges challenge
      where challenge.id = group_stakes.challenge_id
        and challenge.circle_id = group_stakes.circle_id
    )
  )
);
