import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0009_harden_proof_downvotes.sql', import.meta.url), 'utf8');
const pushFunction = await readFile(new URL('../supabase/functions/send-nudge/index.ts', import.meta.url), 'utf8');

test('proof vote migration prevents self downvotes and scopes votes to circle members', () => {
  assert.match(migration, /emoji <> '👎' or ci\.user_id <> \(select auth\.uid\(\)\)/);
  assert.match(migration, /h\.circle_id in \(select private\.user_circle_ids\(\)\)/);
  assert.match(migration, /reactions_delete_self/);
});

test('push sender is authenticated, pinned, and prunes dead subscriptions', () => {
  assert.match(pushFunction, /web-push@3\.6\.7/);
  assert.match(pushFunction, /@supabase\/supabase-js@2\.112\.4/);
  assert.match(pushFunction, /vapid-public-key/);
  assert.match(pushFunction, /nudge\.from_user_id !== user\.id/);
  assert.match(pushFunction, /statusCode === 404 \|\| statusCode === 410/);
  assert.doesNotMatch(pushFunction, /VAPID_PRIVATE_KEY/);
});
