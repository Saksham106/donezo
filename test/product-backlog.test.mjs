import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';
const app = uiSource;
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/0015_social_accountability.sql', import.meta.url), 'utf8').catch(() => '');
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('Squad supports positive reactions, friend drill-down, and bounded incremental feed', () => {
  assert.match(app, /data-reaction/);
  assert.match(app, /friendProfileSheet/);
  assert.match(app, /data-friend-profile/);
  assert.match(app, /feedLimit/);
  assert.match(app, /data-load-more/);
  assert.match(store, /toggleReaction/);
});

test('non-daily schedules keep legacy habit metadata compatible and persist through schedule versions', () => {
  assert.equal((store.match(/habit_frequency: 'daily'/g) || []).length, 2);
  assert.match(store, /p_schedule_frequency: schedule\.frequency/);
});

test('social migration locks stakes after activation and preserves auditable history', () => {
  assert.match(migration, /create table if not exists public\.weekly_challenges/i);
  assert.match(migration, /create table if not exists public\.habit_recoveries/i);
  assert.match(migration, /create table if not exists public\.group_stakes/i);
  assert.match(migration, /create table if not exists public\.stake_consents/i);
  assert.match(migration, /create trigger lock_active_stake_rules/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\)/i);
});

test('new social surfaces keep 44px targets and mobile keyboard safe sheets', () => {
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /\.friend-profile-sheet/);
  assert.match(css, /\.recap-card/);
  assert.match(css, /padding-bottom:\s*calc\([^}]*safe-area-inset-bottom/s);
});
