import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0013_schedule_engine.sql', import.meta.url), 'utf8');

test('schedule migration adds backwards-compatible schedule fields and validates values', () => {
  assert.match(migration, /alter table public\.habits[\s\S]*add column if not exists schedule_timezone text not null default 'America\/New_York'/);
  assert.match(migration, /add column if not exists schedule_frequency text not null default 'daily'/);
  assert.match(migration, /add column if not exists schedule_weekdays smallint\[\]/);
  assert.match(migration, /add column if not exists target_quantity numeric not null default 1/);
  assert.match(migration, /add column if not exists target_unit text not null default 'count'/);
  assert.match(migration, /add column if not exists due_time time/);
  assert.match(migration, /add column if not exists grace_minutes integer not null default 0/);
  assert.match(migration, /schedule_frequency.*daily.*selected_weekdays.*weekly/s);
  assert.match(migration, /target_quantity > 0/);
  assert.match(migration, /grace_minutes between 0 and 10080/);
});

test('schedule migration backfills one immutable version for every existing habit', () => {
  assert.match(migration, /create table if not exists public\.habit_schedule_versions/);
  assert.match(migration, /habit_id uuid not null references public\.habits\(id\) on delete cascade/);
  assert.match(migration, /version integer not null/);
  assert.match(migration, /effective_from date not null/);
  assert.match(migration, /unique \(habit_id, version\)/);
  assert.match(migration, /insert into public\.habit_schedule_versions[\s\S]*select[\s\S]*from public\.habits/s);
  assert.match(migration, /on conflict \(habit_id, version\) do nothing/);
  assert.match(migration, /capture_initial_habit_schedule/);
  assert.match(migration, /after insert on public\.habits/);
  assert.match(migration, /if latest\.effective_from = p_effective_from[\s\S]*public\.check_ins/s);
});

test('pause windows are normalized, bounded, and protected by row-level security', () => {
  assert.match(migration, /create table if not exists public\.habit_schedule_pauses/);
  assert.match(migration, /start_date date not null/);
  assert.match(migration, /end_date date not null/);
  assert.match(migration, /check \(end_date >= start_date\)/);
  assert.match(migration, /alter table public\.habit_schedule_versions enable row level security/);
  assert.match(migration, /alter table public\.habit_schedule_pauses enable row level security/);
  assert.match(migration, /schedule_versions_select_owner_or_member/);
  assert.match(migration, /schedule_pauses_select_owner_or_member/);
});

test('schedule version changes are owner-only and preserve historical rows', () => {
  assert.match(migration, /create or replace function public\.create_habit_schedule_version/);
  assert.match(migration, /security definer/);
  assert.match(migration, /effective_until = p_effective_from/);
  assert.match(migration, /insert into public\.habit_schedule_versions/);
  assert.match(migration, /revoke (insert|update|delete).*habit_schedule_versions.*authenticated/s);
  assert.match(migration, /grant execute on function public\.create_habit_schedule_version/);
  assert.doesNotMatch(migration, /grant (all|insert|update|delete) on table public\.habit_schedule_versions to authenticated/i);
});

test('schedule access is scoped through habit ownership or exact shared squads', () => {
  assert.match(migration, /private\.habit_visible_to_current_user\(habit_id\)/);
  assert.match(migration, /create policy schedule_versions_insert_owner/);
  assert.match(migration, /create policy schedule_pauses_insert_owner/);
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/);
});

test('legacy daily habit writes keep target_time and due_time compatible', () => {
  assert.match(migration, /sync_legacy_habit_schedule/);
  assert.match(migration, /before insert or update on public\.habits/);
  assert.match(migration, /new\.due_time := new\.target_time/);
});
