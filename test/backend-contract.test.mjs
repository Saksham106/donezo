import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0009_harden_proof_downvotes.sql', import.meta.url), 'utf8');
const serviceRoleMigration = await readFile(new URL('../supabase/migrations/0010_grant_send_nudge_service_role.sql', import.meta.url), 'utf8');
const readReceiptMigration = await readFile(new URL('../supabase/migrations/0011_allow_safe_nudge_read_receipts.sql', import.meta.url), 'utf8');
const notificationMigration = await readFile(new URL('../supabase/migrations/0014_notification_preferences_and_events.sql', import.meta.url), 'utf8');
const recapPreferenceMigration = await readFile(new URL('../supabase/migrations/0016_recap_award_preferences.sql', import.meta.url), 'utf8');
const quantityMigration = await readFile(new URL('../supabase/migrations/0017_check_in_quantities.sql', import.meta.url), 'utf8');
const socialHardeningMigration = await readFile(new URL('../supabase/migrations/0018_harden_social_resolution.sql', import.meta.url), 'utf8');
const pushFunction = await readFile(new URL('../supabase/functions/send-nudge/index.ts', import.meta.url), 'utf8');

test('proof vote migration prevents self downvotes and scopes votes to circle members', () => {
  assert.match(migration, /ci\.proof_path is not null/);
  assert.match(migration, /ci\.user_id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /h\.circle_id in \(select private\.user_circle_ids\(\)\)/);
  assert.match(migration, /reactions_delete_self/);
});

test('push sender gets only the service-role privileges it needs', () => {
  assert.match(serviceRoleMigration, /grant select on table public\.nudges to service_role/);
  assert.match(serviceRoleMigration, /grant select on table public\.circle_members to service_role/);
  assert.match(serviceRoleMigration, /grant select on table public\.profiles to service_role/);
  assert.match(serviceRoleMigration, /grant select, delete on table public\.push_subscriptions to service_role/);
  assert.doesNotMatch(serviceRoleMigration, /grant all/i);
});

test('nudge receipts expose only the read_at column to recipients', () => {
  assert.match(readReceiptMigration, /grant update \(read_at\) on table public\.nudges to authenticated/);
  assert.match(readReceiptMigration, /nudges_mark_read_recipient/);
  assert.match(readReceiptMigration, /to_user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(readReceiptMigration, /grant update on table/i);
});

test('push sender is authenticated, pinned, and prunes dead subscriptions', () => {
  assert.match(pushFunction, /web-push@3\.6\.7/);
  assert.match(pushFunction, /@supabase\/supabase-js@2\.112\.4/);
  assert.match(pushFunction, /vapid-public-key/);
  assert.match(pushFunction, /nudge\.from_user_id !== user\.id/);
  assert.match(pushFunction, /statusCode === 404 \|\| statusCode === 410/);
  assert.match(pushFunction, /return json\(\{ delivered, failed, pruned, suppressed: false, deduped: false \}\)/);
  assert.match(pushFunction, /Could not load nudge/);
  assert.doesNotMatch(pushFunction, /VAPID_PRIVATE_KEY/);
});

test('notification migration stores scoped preferences and deduplicated contextual events', () => {
  assert.match(notificationMigration, /create table if not exists public\.notification_preferences/i);
  assert.match(notificationMigration, /create table if not exists public\.notification_events/i);
  assert.match(notificationMigration, /quiet_hours_start time/i);
  assert.match(notificationMigration, /quiet_hours_end time/i);
  assert.match(notificationMigration, /timezone text/i);
  assert.match(notificationMigration, /categories jsonb/i);
  assert.match(notificationMigration, /habit_overrides jsonb/i);
  assert.match(notificationMigration, /unique \(recipient_user_id, dedupe_key\)/i);
  assert.match(notificationMigration, /alter table public\.notification_preferences enable row level security/i);
  assert.match(notificationMigration, /alter table public\.notification_events enable row level security/i);
  assert.match(notificationMigration, /notification_preferences_owner/i);
  assert.match(notificationMigration, /notification_events_recipient/i);
});

test('notification migration enforces server-side policy, safe links, and least-privilege writes', () => {
  assert.match(notificationMigration, /notification_preference_allows/i);
  assert.match(notificationMigration, /local_time >= quiet_end and local_time < quiet_start/i);
  assert.match(notificationMigration, /deep_link like '\/%'/i);
  assert.match(notificationMigration, /revoke insert, update, delete on table public\.notification_events from authenticated/i);
  assert.match(notificationMigration, /grant select, insert, update on table public\.notification_events to service_role/i);
  assert.match(notificationMigration, /enqueue_notification_event/i);
  assert.match(notificationMigration, /on conflict \(recipient_user_id, dedupe_key\) do nothing/i);
});

test('recap awards default on and provide an explicit opt-out field', () => {
  assert.match(recapPreferenceMigration, /recap_awards_enabled boolean not null default true/i);
  assert.match(recapPreferenceMigration, /excluded from named weekly recap awards and exports/i);
});

test('check-ins persist a bounded completed quantity', () => {
  assert.match(quantityMigration, /completed_quantity numeric not null default 1/i);
  assert.match(quantityMigration, /completed_quantity > 0 and completed_quantity <= 1000000/i);
});

test('social resolution exposes only safe update columns and validates terminal settlement', () => {
  assert.match(socialHardeningMigration, /grant update \(status, resolved_at\).*weekly_challenges/is);
  assert.match(socialHardeningMigration, /grant update \(status, resolution, resolved_at\).*group_stakes/is);
  assert.match(socialHardeningMigration, /current_date <= old\.ends_on/i);
  assert.match(socialHardeningMigration, /Stake resolution contains a non-participant/i);
});

test('push sender turns a nudge into a policy-checked event and preserves its context', () => {
  assert.match(pushFunction, /enqueue_notification_event/);
  assert.match(pushFunction, /target_notification_category: 'nudge'/);
  assert.match(pushFunction, /source_nudge_id/);
  assert.match(pushFunction, /event\?\.deduped/);
  assert.match(pushFunction, /event\?\.suppressed/);
  assert.match(pushFunction, /nudges=1/);
  assert.match(pushFunction, /group_key/);
});
