import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sender = await readFile(new URL('../supabase/functions/send-nudge/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260901_notification_nudge_worker_unification.sql', import.meta.url), 'utf8').catch(() => '');

test('nudges use the shared notification worker instead of a second direct Web Push sender', () => {
  assert.match(sender, /enqueue_notification_event/);
  assert.match(sender, /queued:\s*true/);
  assert.doesNotMatch(sender, /webpush\.sendNotification/);
  assert.doesNotMatch(sender, /from\('push_subscriptions'\)/);
});

test('new nudge notification events wake the same authenticated worker as other social events', () => {
  assert.match(migration, /drop trigger if exists wake_notification_worker on public\.notification_events/i);
  assert.match(migration, /create trigger wake_notification_worker/i);
  assert.match(migration, /new\.category in \([^)]*'nudge'/i);
  assert.match(migration, /private\.wake_notification_worker\(\)/i);
});
