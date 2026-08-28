import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0009_harden_proof_downvotes.sql', import.meta.url), 'utf8');
const serviceRoleMigration = await readFile(new URL('../supabase/migrations/0010_grant_send_nudge_service_role.sql', import.meta.url), 'utf8');
const readReceiptMigration = await readFile(new URL('../supabase/migrations/0011_allow_safe_nudge_read_receipts.sql', import.meta.url), 'utf8');
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
  assert.match(pushFunction, /return json\(\{ delivered, failed, pruned \}\)/);
  assert.match(pushFunction, /Could not load nudge/);
  assert.doesNotMatch(pushFunction, /VAPID_PRIVATE_KEY/);
});
