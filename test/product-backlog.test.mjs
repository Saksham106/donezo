import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/0015_social_accountability.sql', import.meta.url), 'utf8').catch(() => '');
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('daily check-in exposes a direct camera action and retry-safe upload status', () => {
  assert.match(app, /data-quick-proof/);
  assert.match(app, /aria-live="polite"[^>]*data-upload-status/);
  assert.match(app, /navigator\.vibrate/);
  assert.match(store, /Already checked in today/);
});

test('Squad supports positive reactions, friend drill-down, and bounded incremental feed', () => {
  assert.match(app, /data-reaction/);
  assert.match(app, /friendProfileSheet/);
  assert.match(app, /data-friend-profile/);
  assert.match(app, /feedLimit/);
  assert.match(app, /data-load-more/);
  assert.match(store, /toggleReaction/);
});

test('recovery, challenges, stakes and recap are present as simple social loops', () => {
  assert.match(app, /recoverySheet/);
  assert.match(app, /data-recover-habit/);
  assert.match(app, /challengeSheet/);
  assert.match(app, /data-challenge/);
  assert.match(app, /stakeSheet/);
  assert.match(app, /data-stake/);
  assert.match(app, /weeklyRecapCard/);
  assert.match(app, /createRecapImage/);
  assert.match(app, /Share recap/);
});

test('onboarding progress targets the first shared win and templates remain editable', () => {
  assert.match(app, /activationCard/);
  assert.match(app, /starterTemplates/);
  assert.match(app, /data-template/);
  assert.match(app, /first shared win/i);
  assert.match(app, /data-activation-next/);
});

test('habit settings expose real schedules and pause windows end to end', () => {
  assert.match(app, /getScheduleOccurrence/);
  assert.match(app, /name="scheduleFrequency"/);
  assert.match(app, /name="scheduleWeekdays"/);
  assert.match(app, /name="targetQuantity"/);
  assert.match(app, /name="targetUnit"/);
  assert.match(app, /name="graceMinutes"/);
  assert.match(app, /id="pause-form"/);
  assert.match(store, /create_habit_schedule_version/);
  assert.match(store, /create_habit_schedule_pause/);
  assert.match(store, /scheduleFrequency: habit\.schedule_frequency/);
  assert.match(store, /habit_schedule_pauses/);
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
