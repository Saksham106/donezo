-- Donezo initial backend schema
-- Supabase/Postgres 17

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null,
  avatar_url text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create index circle_members_user_id_idx on public.circle_members(user_id);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  emoji text not null default '⚡',
  frequency text not null default 'daily',
  target_time time,
  proof_mode text not null default 'none' check (proof_mode in ('none', 'photo')),
  xp integer not null default 10 check (xp between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index habits_circle_id_idx on public.habits(circle_id);
create index habits_owner_id_idx on public.habits(owner_id);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  check_date date not null default current_date,
  completed_at timestamptz not null default now(),
  proof_path text,
  note text check (note is null or char_length(note) <= 280),
  unique (habit_id, user_id, check_date)
);

create index check_ins_user_date_idx on public.check_ins(user_id, check_date desc);
create index check_ins_habit_id_idx on public.check_ins(habit_id);

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 140),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (from_user_id <> to_user_id)
);

create index nudges_to_user_created_idx on public.nudges(to_user_id, created_at desc);
create index nudges_circle_id_idx on public.nudges(circle_id);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references public.check_ins(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (check_in_id, user_id, emoji)
);

create index reactions_check_in_id_idx on public.reactions(check_in_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

-- Membership helpers live outside the exposed public schema so policies can
-- inspect memberships without recursive RLS evaluation.
create or replace function private.user_circle_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.circle_id
  from public.circle_members cm
  where cm.user_id = (select auth.uid());
$$;

create or replace function private.is_circle_owner(target_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circles c
    where c.id = target_circle and c.owner_id = (select auth.uid())
  );
$$;

create or replace function private.circle_exists(target_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.circles c where c.id = target_circle);
$$;

create or replace function private.is_user_in_circle(target_user uuid, target_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circle_members cm
    where cm.circle_id = target_circle and cm.user_id = target_user
  );
$$;

create or replace function private.shares_circle_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid()) or exists (
    select 1
    from public.circle_members mine
    join public.circle_members theirs on theirs.circle_id = mine.circle_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = target_user
  );
$$;

create or replace function private.add_circle_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.circle_members(circle_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

revoke all on function private.user_circle_ids() from public, anon, authenticated;
revoke all on function private.is_circle_owner(uuid) from public, anon, authenticated;
revoke all on function private.circle_exists(uuid) from public, anon, authenticated;
revoke all on function private.is_user_in_circle(uuid, uuid) from public, anon, authenticated;
revoke all on function private.shares_circle_with(uuid) from public, anon, authenticated;
revoke all on function private.add_circle_owner_membership() from public, anon, authenticated;

grant execute on function private.user_circle_ids() to authenticated;
grant execute on function private.is_circle_owner(uuid) to authenticated;
grant execute on function private.circle_exists(uuid) to authenticated;
grant execute on function private.is_user_in_circle(uuid, uuid) to authenticated;
grant execute on function private.shares_circle_with(uuid) to authenticated;

create trigger add_circle_owner_membership
  after insert on public.circles
  for each row execute function private.add_circle_owner_membership();

-- Explicit Data API grants. New Supabase projects no longer expose newly-created
-- public tables automatically.
revoke all on table public.profiles, public.circles, public.circle_members,
  public.habits, public.check_ins, public.nudges, public.reactions,
  public.push_subscriptions from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.circles to authenticated;
grant select, insert, update, delete on public.circle_members to authenticated;
grant select, insert, update, delete on public.habits to authenticated;
grant select, insert, update, delete on public.check_ins to authenticated;
grant select, insert, update, delete on public.nudges to authenticated;
grant select, insert, delete on public.reactions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.habits enable row level security;
alter table public.check_ins enable row level security;
alter table public.nudges enable row level security;
alter table public.reactions enable row level security;
alter table public.push_subscriptions enable row level security;

create policy profiles_select_circle_peers
on public.profiles for select to authenticated
using ((select private.shares_circle_with(id)));

create policy profiles_insert_self
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_self
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy circles_select_members
on public.circles for select to authenticated
using (id in (select private.user_circle_ids()) or owner_id = (select auth.uid()));

create policy circles_insert_owner
on public.circles for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy circles_update_owner
on public.circles for update to authenticated
using ((select private.is_circle_owner(id)))
with check (owner_id = (select auth.uid()));

create policy circles_delete_owner
on public.circles for delete to authenticated
using ((select private.is_circle_owner(id)));

create policy circle_members_select_members
on public.circle_members for select to authenticated
using (circle_id in (select private.user_circle_ids()));

-- Possession of the unguessable circle UUID acts as the MVP invite token.
create policy circle_members_insert_self_or_owner
on public.circle_members for insert to authenticated
with check (
  (user_id = (select auth.uid()) and (select private.circle_exists(circle_id)))
  or (select private.is_circle_owner(circle_id))
);

create policy circle_members_update_owner
on public.circle_members for update to authenticated
using ((select private.is_circle_owner(circle_id)))
with check ((select private.is_circle_owner(circle_id)));

create policy circle_members_delete_self_or_owner
on public.circle_members for delete to authenticated
using (user_id = (select auth.uid()) or (select private.is_circle_owner(circle_id)));

create policy habits_select_circle_members
on public.habits for select to authenticated
using (circle_id in (select private.user_circle_ids()));

create policy habits_insert_owner
on public.habits for insert to authenticated
with check (owner_id = (select auth.uid()) and circle_id in (select private.user_circle_ids()));

create policy habits_update_owner
on public.habits for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()) and circle_id in (select private.user_circle_ids()));

create policy habits_delete_owner
on public.habits for delete to authenticated
using (owner_id = (select auth.uid()));

create policy check_ins_select_circle_members
on public.check_ins for select to authenticated
using (exists (
  select 1 from public.habits h
  where h.id = habit_id and h.circle_id in (select private.user_circle_ids())
));

create policy check_ins_insert_self
on public.check_ins for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.habits h where h.id = habit_id and h.owner_id = (select auth.uid()))
);

create policy check_ins_update_self
on public.check_ins for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy check_ins_delete_self
on public.check_ins for delete to authenticated
using (user_id = (select auth.uid()));

create policy nudges_select_sender_or_recipient
on public.nudges for select to authenticated
using (
  circle_id in (select private.user_circle_ids())
  and (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
);

create policy nudges_insert_sender
on public.nudges for insert to authenticated
with check (
  from_user_id = (select auth.uid())
  and circle_id in (select private.user_circle_ids())
  and (select private.is_user_in_circle(to_user_id, circle_id))
);

create policy nudges_update_recipient
on public.nudges for update to authenticated
using (to_user_id = (select auth.uid()))
with check (to_user_id = (select auth.uid()));

create policy nudges_delete_sender
on public.nudges for delete to authenticated
using (from_user_id = (select auth.uid()));

create policy reactions_select_visible_checkins
on public.reactions for select to authenticated
using (exists (select 1 from public.check_ins ci where ci.id = check_in_id));

create policy reactions_insert_self
on public.reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.check_ins ci where ci.id = check_in_id)
);

create policy reactions_delete_self
on public.reactions for delete to authenticated
using (user_id = (select auth.uid()));

create policy push_subscriptions_select_self
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_self
on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_self
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_self
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));

-- Private proof images. Store each object under <user_uuid>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 4194304, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy proof_objects_select_circle_peers
on storage.objects for select to authenticated
using (
  bucket_id = 'proofs'
  and (select private.shares_circle_with(((storage.foldername(name))[1])::uuid))
);

create policy proof_objects_insert_self
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proofs'
  and ((storage.foldername(name))[1]) = (select auth.uid())::text
);

create policy proof_objects_update_self
on storage.objects for update to authenticated
using (
  bucket_id = 'proofs'
  and ((storage.foldername(name))[1]) = (select auth.uid())::text
)
with check (
  bucket_id = 'proofs'
  and ((storage.foldername(name))[1]) = (select auth.uid())::text
);

create policy proof_objects_delete_self
on storage.objects for delete to authenticated
using (
  bucket_id = 'proofs'
  and ((storage.foldername(name))[1]) = (select auth.uid())::text
);
