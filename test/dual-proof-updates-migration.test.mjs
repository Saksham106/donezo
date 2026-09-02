import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260902_dual_photo_updates_state.sql', import.meta.url), 'utf8');

test('dual photo proof mode is accepted and every non-none mode remains proof-required', () => {
  assert.match(migration, /proof_mode\s+in\s*\(\s*'none'\s*,\s*'photo'\s*,\s*'dual_photo'\s*\)/i);
  assert.match(migration, /h\.proof_mode\s*=\s*'none'\s+and\s+proof_path\s+is\s+null/i);
  assert.match(migration, /h\.proof_mode\s*<>\s*'none'\s+and\s+proof_path\s+is\s+not\s+null/i);
});

test('updates high-water state is private to its owner', () => {
  assert.match(migration, /create table[^;]*user_update_state/i);
  assert.match(migration, /last_seen_at\s+timestamptz\s+not\s+null/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /user_update_state[^;]*for select[^;]*auth\.uid\(\)\s*=\s*user_id/is);
  assert.match(migration, /user_update_state[^;]*for insert[^;]*auth\.uid\(\)\s*=\s*user_id/is);
  assert.match(migration, /user_update_state[^;]*for update[^;]*auth\.uid\(\)\s*=\s*user_id/is);
});

test('mark_updates_seen uses one server timestamp for nudges and activity high-water state', () => {
  assert.match(migration, /create or replace function public\.mark_updates_seen\(\)[\s\S]*returns timestamptz/i);
  assert.match(migration, /marked_at\s+timestamptz\s*:=\s*clock_timestamp\(\)/i);
  assert.match(migration, /update public\.nudges[\s\S]*read_at\s*=\s*marked_at[\s\S]*to_user_id\s*=\s*actor[\s\S]*read_at\s+is\s+null/i);
  assert.match(migration, /insert into public\.user_update_state[\s\S]*marked_at[\s\S]*on conflict\s*\(user_id\)[\s\S]*last_seen_at/i);
  assert.match(migration, /return marked_at/i);
  assert.match(migration, /grant execute on function public\.mark_updates_seen\(\) to authenticated/i);
});
