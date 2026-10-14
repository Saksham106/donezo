import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const notifications = await readFile(new URL('../src/notifications.js', import.meta.url), 'utf8');
const sender = await readFile(new URL('../supabase/functions/send-nudge/index.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../supabase/functions/notification-worker/index.ts', import.meta.url), 'utf8').catch(() => '');
const migration = await readFile(new URL('../supabase/migrations/20260901_notification_delivery_pipeline.sql', import.meta.url), 'utf8').catch(() => '');
const workerAuthMigration = await readFile(new URL('../supabase/migrations/20260901_notification_worker_auth.sql', import.meta.url), 'utf8').catch(() => '');

test('notification migration wires authoritative social producers and a scheduled reminder pipeline', () => {
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /status in \('pending', 'processing', 'delivered', 'failed', 'suppressed'\)/i);
  assert.match(migration, /claim_notification_events/i);
  assert.match(migration, /enqueue_scheduled_notification_events/i);
  assert.match(migration, /queue_check_in_notifications/i);
  assert.match(migration, /queue_reaction_notification/i);
  assert.match(migration, /queue_comment_notification/i);
  assert.match(migration, /friend_activity/i);
  assert.match(migration, /challenge_progress/i);
  assert.match(migration, /due_soon/i);
  assert.match(migration, /streak_risk/i);
  assert.match(migration, /cron\.schedule/i);
  assert.match(migration, /notification-worker/i);
});

test('notification worker only drains server-owned events and cannot accept arbitrary push payloads', () => {
  assert.match(worker, /claim_notification_events/);
  assert.match(worker, /enqueue_scheduled_notification_events/);
  assert.match(worker, /push_subscriptions/);
  assert.match(worker, /webpush\.sendNotification/);
  assert.match(worker, /status:\s*['"]suppressed['"]/);
  assert.match(worker, /no_subscription/);
  assert.doesNotMatch(worker, /body\??\.recipient/i);
  assert.doesNotMatch(worker, /body\??\.title/i);
  assert.doesNotMatch(worker, /body\??\.message/i);
  assert.doesNotMatch(worker, /body\??\.payload/i);
});

test('notification worker wakeups require a random Vault token instead of an anonymous public drain', () => {
  assert.match(workerAuthMigration, /vault\.create_secret/i);
  assert.match(workerAuthMigration, /donezo_notification_worker_token/);
  assert.match(workerAuthMigration, /verify_notification_worker_token/i);
  assert.match(workerAuthMigration, /x-donezo-worker-token/i);
  assert.match(workerAuthMigration, /vault\.decrypted_secrets/i);
  assert.match(worker, /x-donezo-worker-token/i);
  assert.match(worker, /verify_notification_worker_token/i);
  assert.match(worker, /Unauthorized/);
});

test('shared worker settles queued events when the recipient has no subscription', () => {
  assert.match(worker, /activeSubscriptions\.length === 0/);
  assert.match(worker, /status:\s*['"]suppressed['"]/);
  assert.match(worker, /no_subscription/);
  assert.doesNotMatch(sender, /from\('push_subscriptions'\)/);
  assert.doesNotMatch(sender, /webpush\.sendNotification/);
});
