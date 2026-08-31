import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapDatabaseState } from '../src/store.js';

const migrationUrl = new URL('../supabase/migrations/20260831_flexible_weekly_habits.sql', import.meta.url);
const migration = await readFile(migrationUrl, 'utf8').catch(() => '');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');

test('flexible weekly migration adds explicit target fields and permits times_per_week', () => {
  assert.match(migration, /alter table public\.habits[\s\S]*add column if not exists weekly_target_days integer not null default 1/);
  assert.match(migration, /alter table public\.habit_schedule_versions[\s\S]*add column if not exists weekly_target_days integer not null default 1/);
  assert.match(migration, /habits_schedule_frequency_check[\s\S]*times_per_week/);
  assert.match(migration, /habit_schedule_versions_schedule_frequency_check[\s\S]*times_per_week/);
  assert.match(migration, /weekly_target_days between 1 and 7/);
});

test('schedule RPC persists weekly target while preserving owner authorization and restricted execution', () => {
  assert.match(migration, /create or replace function public\.create_habit_schedule_version\([\s\S]*p_weekly_target_days integer default 1/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /owner_id = actor/);
  assert.match(migration, /p_schedule_frequency not in \('daily', 'selected_weekdays', 'weekly', 'times_per_week'\)/);
  assert.match(migration, /p_weekly_target_days not between 1 and 7/);
  assert.match(migration, /weekly_target_days = p_weekly_target_days/);
  assert.match(migration, /weekly_target_days,[\s\S]*p_weekly_target_days/);
  assert.match(migration, /revoke all on function public\.create_habit_schedule_version[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.create_habit_schedule_version[\s\S]*to authenticated/);
});

test('database state maps current and historical weekly targets', () => {
  const state = mapDatabaseState({ id: 'me', email: 'me@example.com' }, {
    profile: { id: 'me', display_name: 'Me', timezone: 'UTC' },
    habits: [{
      id: 'gym', circle_id: 'c1', owner_id: 'me', title: 'Gym', emoji: '🏋️',
      frequency: 'times_per_week', schedule_frequency: 'times_per_week', schedule_weekdays: [],
      weekly_target_days: 4, target_quantity: 1, target_unit: 'count', due_time: null,
      target_time: null, grace_minutes: 0, schedule_timezone: 'UTC', proof_mode: 'none',
      xp: 10, active: true, created_at: '2026-08-20T12:00:00Z', updated_at: '2026-08-20T12:00:00Z',
    }],
    scheduleVersions: [{
      id: 'v1', habit_id: 'gym', version: 1, effective_from: '2026-08-20', effective_until: null,
      schedule_frequency: 'times_per_week', schedule_weekdays: [], weekly_target_days: 4,
      target_quantity: 1, target_unit: 'count', due_time: null, grace_minutes: 0, timezone: 'UTC',
    }],
    members: [{ user_id: 'me', profiles: { id: 'me', display_name: 'Me', timezone: 'UTC' } }],
    circles: [{ id: 'c1', name: 'Circle', invite_code: 'abc', owner_id: 'me', role: 'owner' }],
    checkIns: [], reactions: [], nudges: [], challenges: [], recoveries: [], friendships: [],
    habitShares: [], schedulePauses: [], comments: [], batonState: [], stakes: [],
  });
  const habit = state.habits.find((item) => item.id === 'gym');
  assert.equal(habit.weeklyTargetDays, 4);
  assert.equal(habit.scheduleVersions[0].weeklyTargetDays, 4);
});

test('repository schedule persistence sends weeklyTargetDays to normalizeSchedule and RPC', () => {
  assert.match(store, /weeklyTargetDays:\s*input\.weeklyTargetDays\s*\?\?\s*1/);
  assert.match(store, /p_weekly_target_days:\s*schedule\.weeklyTargetDays/);
});
