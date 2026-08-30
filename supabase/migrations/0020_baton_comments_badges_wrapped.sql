-- Donezo social foundation: one expiring baton, flat check-in comments, and
-- server-authoritative preferences. Lifetime badges and monthly Wrapped are
-- derived in src/badges-domain.js and src/wrapped-domain.js; no stale awards
-- are materialized here.

create table if not exists public.baton_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  opted_out boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.batons (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  holder_user_id uuid not null references public.profiles(id) on delete cascade,
  source_check_in_id uuid not null references public.check_ins(id) on delete restrict,
  started_at timestamptz not null default now(),
  handed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A boolean is used instead of an index predicate on now(), so expiry is
-- server-maintained and the uniqueness invariant remains indexable.
create unique index if not exists batons_one_active_per_circle
  on public.batons(circle_id) where active;
create index if not exists batons_holder_idx on public.batons(holder_user_id) where active;

create table if not exists public.baton_handoffs (
  id uuid primary key default gen_random_uuid(),
  baton_id uuid not null references public.batons(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete restrict,
  to_user_id uuid not null references public.profiles(id) on delete restrict,
  source_check_in_id uuid not null references public.check_ins(id) on delete restrict,
  handed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (from_user_id <> to_user_id),
  check (expires_at > handed_at)
);
create index if not exists baton_handoffs_circle_idx on public.baton_handoffs(circle_id, handed_at desc);

create table if not exists public.check_in_comments (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references public.check_ins(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 180),
  created_at timestamptz not null default now()
);
create index if not exists check_in_comments_thread_idx on public.check_in_comments(check_in_id, created_at, id);

-- Never let a client bind a comment to a check-in from another circle or edit
-- its author/scope after creation.
create or replace function private.lock_comment_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.check_in_id is distinct from old.check_in_id
      or new.circle_id is distinct from old.circle_id
      or new.author_id is distinct from old.author_id
      or new.body is distinct from old.body
      or new.created_at is distinct from old.created_at then
      raise exception 'Comments are immutable';
    end if;
  end if;
  if not exists (
    select 1
    from public.check_ins ci
    join public.habits h on h.id = ci.habit_id
    where ci.id = new.check_in_id and h.circle_id = new.circle_id
  ) then
    raise exception 'Comment check-in must belong to the same circle';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_comment_scope() from public, anon, authenticated;
drop trigger if exists lock_comment_scope on public.check_in_comments;
create trigger lock_comment_scope
  before insert or update on public.check_in_comments
  for each row execute function private.lock_comment_scope();

-- A baton may only be backed by a completion that still passes the existing
-- proof-review rule. The check is repeated inside each RPC/trigger boundary.
create or replace function private.valid_baton_check_in(target_check_in uuid, expected_user uuid, expected_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.check_ins ci
    join public.habits h on h.id = ci.habit_id
    where ci.id = target_check_in
      and ci.user_id = expected_user
      and ci.completed_at is not null
      and h.circle_id = expected_circle
      and (
        ci.proof_path is null
        or (
          select count(distinct reaction.user_id)
          from public.reactions reaction
          join public.circle_members voter
            on voter.circle_id = expected_circle and voter.user_id = reaction.user_id
          where reaction.check_in_id = ci.id
            and reaction.emoji = '👎'
            and reaction.user_id <> ci.user_id
        ) < floor(((select count(*) from public.circle_members where circle_id = expected_circle) - 1)::numeric / 2) + 1
      )
  );
$$;
revoke all on function private.valid_baton_check_in(uuid, uuid, uuid) from public, anon, authenticated;

-- Handoff history is append-only. The current baton row is the only mutable
-- projection and is changed only by the locked RPC below.
create or replace function private.lock_baton_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then raise exception 'Baton handoff history is immutable'; end if;
  if new.from_user_id = new.to_user_id then raise exception 'Baton recipient must differ from sender'; end if;
  if not exists (
    select 1 from public.batons b
    where b.id = new.baton_id and b.circle_id = new.circle_id
  ) then raise exception 'Baton handoff must belong to its circle'; end if;
  if not exists (
    select 1 from public.check_ins ci
    join public.habits h on h.id = ci.habit_id
    where ci.id = new.source_check_in_id and ci.user_id = new.from_user_id and h.circle_id = new.circle_id
      and private.valid_baton_check_in(ci.id, new.from_user_id, new.circle_id)
  ) then raise exception 'Baton source must be a valid same-circle completion'; end if;
  return new;
end;
$$;
revoke all on function private.lock_baton_handoff() from public, anon, authenticated;
drop trigger if exists lock_baton_handoff on public.baton_handoffs;
create trigger lock_baton_handoff
  before insert or update on public.baton_handoffs
  for each row execute function private.lock_baton_handoff();
create or replace function public.start_baton(
  source_check_in_id uuid,
  recipient_user_id uuid
)
returns public.batons
language plpgsql
security definer
set search_path = ''
as $$
-- recipient must be another active member of the exact source circle.
declare
  caller uuid := auth.uid();
  target_circle uuid;
  result public.batons;
  handoff_expiry timestamptz := now() + interval '24 hours';
begin
  if caller is null then raise exception 'Authentication required'; end if;
  select h.circle_id into target_circle
  from public.check_ins ci join public.habits h on h.id = ci.habit_id
  where ci.id = source_check_in_id and ci.user_id = caller
    and private.valid_baton_check_in(ci.id, caller, h.circle_id);
  if target_circle is null then raise exception 'Valid check-in completion required'; end if;
  if not exists (select 1 from public.circle_members cm where cm.circle_id = target_circle and cm.user_id = caller) then raise exception 'Sender is not an active circle member'; end if;
  if recipient_user_id = caller or not exists (
    select 1 from public.circle_members cm
    where cm.circle_id = target_circle and cm.user_id = recipient_user_id
  ) then raise exception 'Recipient must be another active circle member'; end if;
  if exists (select 1 from public.baton_preferences bp where bp.user_id = recipient_user_id and bp.opted_out) then raise exception 'Recipient opted out of baton passes'; end if;
  -- Expired projections are closed before the partial unique index is used.
  update public.batons set active = false where circle_id = target_circle and active and expires_at <= now();
  insert into public.batons(circle_id, holder_user_id, source_check_in_id, started_at, handed_at, expires_at, active)
  select target_circle, recipient_user_id, source_check_in_id, now(), now(), handoff_expiry, true
  where not exists (select 1 from public.batons b where b.circle_id = target_circle and b.active and b.expires_at > now())
  returning * into result;
  if result.id is null then raise exception 'That circle already has an active baton'; end if;
  insert into public.baton_handoffs(baton_id, circle_id, from_user_id, to_user_id, source_check_in_id, handed_at, expires_at)
  values (result.id, target_circle, caller, recipient_user_id, source_check_in_id, now(), handoff_expiry);
  return result;
end;
$$;

create or replace function public.pass_baton(
  target_baton_id uuid,
  recipient_user_id uuid,
  source_check_in_id uuid
)
returns public.batons
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  baton public.batons;
  result public.batons;
  expiry timestamptz := now() + interval '24 hours';
  source_circle uuid;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  select * into baton from public.batons b where b.id = target_baton_id and b.active for update;
  if baton.id is null then raise exception 'Active baton not found'; end if;
  if baton.expires_at <= now() then
    update public.batons set active = false where id = baton.id and active;
    raise exception 'Baton has expired';
  end if;
  if baton.holder_user_id <> caller then raise exception 'Only the current baton holder can pass it'; end if;
  if recipient_user_id = caller or not exists (
    select 1 from public.circle_members cm
    where cm.circle_id = baton.circle_id and cm.user_id = recipient_user_id
  ) then raise exception 'Recipient must be another active circle member'; end if;
  if exists (select 1 from public.baton_preferences bp where bp.user_id = recipient_user_id and bp.opted_out) then raise exception 'Recipient opted out of baton passes'; end if;
  select h.circle_id into source_circle
  from public.check_ins ci join public.habits h on h.id = ci.habit_id
  where ci.id = source_check_in_id and ci.user_id = caller
    and private.valid_baton_check_in(ci.id, caller, h.circle_id);
  if source_circle is distinct from baton.circle_id then raise exception 'Source check-in must be a valid completion in the baton circle'; end if;
  update public.batons
  set holder_user_id = recipient_user_id, source_check_in_id = pass_baton.source_check_in_id,
      handed_at = now(), expires_at = expiry
  where id = baton.id and active and holder_user_id = caller and expires_at > now()
  returning * into result;
  if result.id is null then raise exception 'Baton was changed concurrently'; end if;
  insert into public.baton_handoffs(baton_id, circle_id, from_user_id, to_user_id, source_check_in_id, handed_at, expires_at)
  values (result.id, result.circle_id, caller, recipient_user_id, source_check_in_id, now(), expiry);
  return result;
end;
$$;

create or replace function public.set_baton_opt_out(enabled boolean)
returns public.baton_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare result public.baton_preferences;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.baton_preferences(user_id, opted_out, updated_at)
  values (auth.uid(), not enabled, now())
  on conflict (user_id) do update set opted_out = excluded.opted_out, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.add_check_in_comment(target_check_in_id uuid, comment_body text)
returns public.check_in_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  circle uuid;
  result public.check_in_comments;
  clean_body text := btrim(comment_body);
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if clean_body is null or char_length(clean_body) not between 1 and 180 then raise exception 'Comment must be 1–180 characters'; end if;
  select h.circle_id into circle
  from public.check_ins ci join public.habits h on h.id = ci.habit_id
  where ci.id = target_check_in_id;
  if circle is null or not exists (select 1 from public.circle_members cm where cm.circle_id = circle and cm.user_id = caller) then raise exception 'Check-in is not visible in your circle'; end if;
  insert into public.check_in_comments(check_in_id, circle_id, author_id, body)
  values (target_check_in_id, circle, caller, clean_body)
  returning * into result;
  return result;
end;
$$;

create or replace function public.delete_check_in_comment(target_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.check_in_comments
  where id = target_comment_id and author_id = auth.uid()
  returning 1 into deleted_count;
  if deleted_count is null then raise exception 'Only your own comment can be deleted'; end if;
  return true;
end;
$$;

revoke all on function public.start_baton(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pass_baton(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_baton_opt_out(boolean) from public, anon, authenticated;
revoke all on function public.add_check_in_comment(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_check_in_comment(uuid) from public, anon, authenticated;
grant execute on function public.start_baton(uuid, uuid) to authenticated;
grant execute on function public.pass_baton(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_baton_opt_out(boolean) to authenticated;
grant execute on function public.add_check_in_comment(uuid, text) to authenticated;
grant execute on function public.delete_check_in_comment(uuid) to authenticated;

revoke all on table public.baton_preferences, public.batons, public.baton_handoffs, public.check_in_comments from anon, authenticated;
grant select on table public.baton_preferences, public.batons, public.baton_handoffs, public.check_in_comments to authenticated;
grant update (opted_out) on table public.baton_preferences to authenticated;

alter table public.baton_preferences enable row level security;
alter table public.batons enable row level security;
alter table public.baton_handoffs enable row level security;
alter table public.check_in_comments enable row level security;

create policy baton_preferences_owner on public.baton_preferences
for select to authenticated using (user_id = (select auth.uid()));
create policy baton_preferences_update_owner on public.baton_preferences
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy batons_select_circle_members on public.batons
for select to authenticated using (circle_id in (select private.user_circle_ids()));
create policy baton_handoffs_select_circle_members on public.baton_handoffs
for select to authenticated using (circle_id in (select private.user_circle_ids()));
create policy check_in_comments_select_circle_members on public.check_in_comments
for select to authenticated using (
  circle_id in (select private.user_circle_ids())
  and exists (select 1 from public.check_ins ci join public.habits h on h.id = ci.habit_id where ci.id = check_in_id and h.circle_id = check_in_comments.circle_id)
);

-- Clients cannot forge author, circle, baton holder, expiry, or handoff history.
revoke insert, update, delete on table public.batons from authenticated;
revoke update, delete on table public.baton_handoffs from authenticated;
revoke insert, update, delete on table public.baton_handoffs from authenticated;
revoke insert, update, delete on table public.check_in_comments from authenticated;
revoke insert, delete on table public.baton_preferences from authenticated;
