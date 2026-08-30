import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0023_friend_graph_helper_hardening.sql', import.meta.url), 'utf8');

test('friend graph helpers reject unrelated-principal probes', () => {
  assert.match(migration, /first_user\s*=\s*\(select auth\.uid\(\)\)\s+or\s+second_user\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration, /target_user\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on function private\.are_direct_friends\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function private\.direct_friend_ids\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function private\.are_direct_friends\(uuid, uuid\) to authenticated/i);
  assert.match(migration, /grant execute on function private\.direct_friend_ids\(uuid\) to authenticated/i);
});
