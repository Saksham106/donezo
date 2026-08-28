import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapDatabaseState } from '../src/store.js';

const migrationUrl = new URL('../supabase/migrations/0012_multi_squad_foundation.sql', import.meta.url);
const appUrl = new URL('../src/app.js', import.meta.url);
const storeUrl = new URL('../src/store.js', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('migration replaces the one-circle invariant with exact habit-to-squad sharing', async () => {
  const sql = await source(migrationUrl);
  assert.match(sql, /drop index if exists public\.circle_members_one_circle_per_user/i);
  assert.match(sql, /create table(?: if not exists)? public\.habit_circles/i);
  assert.match(sql, /primary key \(habit_id, circle_id\)/i);
  assert.match(sql, /insert into public\.habit_circles[\s\S]*select (?:h\.)?id, (?:h\.)?circle_id from public\.habits/i);
  assert.match(sql, /alter table public\.habit_circles enable row level security/i);
  assert.match(sql, /revoke insert, delete on public\.habit_circles from authenticated/i);
  assert.match(sql, /grant select on public\.habit_circles to authenticated/i);
  assert.match(sql, /habit_circles_insert_owner/i);
  assert.match(sql, /private\.habit_visible_to_current_user/i);
});

test('migration exposes public callouts to squad members but keeps private nudges private', async () => {
  const sql = await source(migrationUrl);
  assert.match(sql, /add column if not exists visibility text not null default 'private'/i);
  assert.match(sql, /visibility in \('private', 'squad'\)/i);
  assert.match(sql, /visibility = 'squad'[\s\S]*circle_id in \(select private\.user_circle_ids\(\)\)/i);
  assert.match(sql, /else from_user_id = \(select auth\.uid\(\)\) or to_user_id = \(select auth\.uid\(\)\)/i);
});

test('migration provides atomic owner-only habit creation and sharing RPCs', async () => {
  const sql = await source(migrationUrl);
  assert.match(sql, /create or replace function public\.create_habit_with_squads/i);
  assert.match(sql, /create or replace function public\.update_habit_with_squads/i);
  assert.match(sql, /for key share/i);
  assert.match(sql, /if requested_squads is null or cardinality\(requested_squads\) = 0/i);
  assert.match(sql, /membership_count <> cardinality\(requested_squads\)/i);
  assert.match(sql, /where id = target_habit_id and owner_id = actor/i);
});

test('database state exposes all squads and selected habit shares', () => {
  const user = { id: 'me', email: 'me@example.com' };
  const state = mapDatabaseState(user, {
    profile: { id: 'me', display_name: 'Me', timezone: 'UTC' },
    circles: [
      { id: 'family', name: 'Family', invite_code: 'family123456', role: 'owner' },
      { id: 'bu', name: 'BU Boys', invite_code: 'buboys123456', role: 'member' },
    ],
    circle: { id: 'bu', name: 'BU Boys', invite_code: 'buboys123456' },
    members: [{ user_id: 'me', profiles: { id: 'me', display_name: 'Me', timezone: 'UTC' } }],
    habits: [{ id: 'run', circle_id: 'family', owner_id: 'me', title: 'Run', emoji: '🏃', frequency: 'daily', target_time: null, proof_mode: 'photo', xp: 10, active: true }],
    habitShares: [{ habit_id: 'run', circle_id: 'family' }, { habit_id: 'run', circle_id: 'bu' }],
    checkIns: [], reactions: [], nudges: [],
  });
  assert.deepEqual(state.circles.map((circle) => circle.id), ['family', 'bu']);
  assert.equal(state.circleId, 'bu');
  assert.deepEqual(state.habits[0].squadIds, ['family', 'bu']);
});

test('repository and UI support switching squads and selecting habit visibility', async () => {
  const [store, app] = await Promise.all([source(storeUrl), source(appUrl)]);
  assert.match(store, /async function selectCircle\(circleId\)/);
  assert.match(store, /async function load\(requestedCircleId = state\.circleId\)/);
  assert.match(store, /create_habit_with_squads/);
  assert.match(store, /update_habit_with_squads/);
  assert.match(app, /data-squad-switcher/);
  assert.match(app, /repo\.selectCircle/);
  assert.match(app, /name="squadIds"/);
});

test('editing a habit out of the active squad does not silently switch squads', async () => {
  const store = await source(storeUrl);
  assert.match(store, /async function updateHabit[\s\S]*?await load\(state\.circleId\)[\s\S]*?\|\| \{ id: updatedId \}/);
  assert.doesNotMatch(store, /await load\(squadIds\.includes\(state\.circleId\)/);
});

test('nudge composer makes squad callout versus private delivery explicit', async () => {
  const app = await source(appUrl);
  assert.match(app, /name="visibility"/);
  assert.match(app, /value="squad"/);
  assert.match(app, /value="private"/);
  assert.match(app, /Public callout/);
  assert.match(app, /Private nudge/);
});
