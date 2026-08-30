-- Restrict social updates to lifecycle fields and validate terminal settlement.

revoke update on table public.weekly_challenges from authenticated;
grant update (status, resolved_at) on table public.weekly_challenges to authenticated;

revoke update on table public.group_stakes from authenticated;
grant update (status, resolution, resolved_at) on table public.group_stakes to authenticated;

create or replace function private.lock_challenge_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.circle_id is distinct from old.circle_id
    or new.created_by is distinct from old.created_by
    or new.kind is distinct from old.kind
    or new.title is distinct from old.title
    or new.target is distinct from old.target
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on then
    raise exception 'Challenge definition is locked';
  end if;

  if old.status <> 'active' and new.status is distinct from old.status then
    raise exception 'Finished challenges are immutable';
  end if;
  if old.status = 'active' and new.status not in ('active', 'completed', 'failed', 'cancelled') then
    raise exception 'Invalid challenge status transition';
  end if;
  if new.status in ('completed', 'failed') and new.resolved_at is null then
    raise exception 'Finished challenges require a resolution timestamp';
  end if;
  if new.status in ('active', 'cancelled') and new.resolved_at is not null then
    raise exception 'Resolution timestamp is only valid for completed challenges';
  end if;

  return new;
end;
$$;

revoke all on function private.lock_challenge_definition() from public, anon, authenticated;

drop trigger if exists lock_challenge_definition on public.weekly_challenges;
create trigger lock_challenge_definition
  before update on public.weekly_challenges
  for each row execute function private.lock_challenge_definition();

create or replace function private.lock_active_stake_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule is distinct from old.rule
    or new.reward is distinct from old.reward
    or new.consequence is distinct from old.consequence
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.circle_id is distinct from old.circle_id
    or new.challenge_id is distinct from old.challenge_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Stake definition is locked';
  end if;

  if old.status in ('resolved', 'declined', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Finished stakes are immutable';
  end if;
  if old.status = 'pending' and new.status not in ('pending', 'active', 'declined', 'cancelled') then
    raise exception 'Invalid pending stake transition';
  end if;
  if old.status = 'active' and new.status not in ('active', 'resolved', 'cancelled') then
    raise exception 'Invalid active stake transition';
  end if;

  if old.status = 'pending' and new.status = 'active' and not exists (
    select 1
    from public.circle_members member
    where member.circle_id = old.circle_id
      and not exists (
        select 1
        from public.stake_consents consent
        where consent.stake_id = old.id
          and consent.user_id = member.user_id
          and consent.status = 'accepted'
      )
  ) then
    raise exception 'Every participant must accept before activation';
  end if;

  if new.status = 'resolved' then
    if old.status <> 'active' then
      raise exception 'Only an active stake can be resolved';
    end if;
    if current_date <= old.ends_on then
      raise exception 'Stake cannot be resolved before it ends';
    end if;
    if new.resolved_at is null then
      raise exception 'Resolved stakes require a resolution timestamp';
    end if;
    if jsonb_typeof(new.resolution) <> 'object'
      or coalesce(jsonb_typeof(new.resolution -> 'winners'), '') <> 'array'
      or coalesce(jsonb_typeof(new.resolution -> 'losers'), '') <> 'array'
      or coalesce(jsonb_typeof(new.resolution -> 'allSucceeded'), '') <> 'boolean' then
      raise exception 'Stake resolution has an invalid shape';
    end if;
    if exists (
      select 1
      from (
        select jsonb_array_elements_text(new.resolution -> 'winners') as user_id
        union all
        select jsonb_array_elements_text(new.resolution -> 'losers') as user_id
      ) resolved_member
      where not exists (
        select 1 from public.circle_members member
        where member.circle_id = old.circle_id
          and member.user_id::text = resolved_member.user_id
      )
    ) then
      raise exception 'Stake resolution contains a non-participant';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(new.resolution -> 'winners') winner(user_id)
      join jsonb_array_elements_text(new.resolution -> 'losers') loser(user_id)
        using (user_id)
    ) then
      raise exception 'A participant cannot be both winner and loser';
    end if;
  elsif new.resolution is not null or new.resolved_at is not null then
    raise exception 'Resolution is only valid for resolved stakes';
  end if;

  return new;
end;
$$;

revoke all on function private.lock_active_stake_rules() from public, anon, authenticated;
