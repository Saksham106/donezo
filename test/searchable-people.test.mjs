import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../supabase/migrations/20260902195000_searchable_people.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

test('searchable People migration makes usernames required and safe', () => {
  assert.match(migration, /alter table public\.profiles[\s\S]*username[\s\S]*not null/i);
  assert.match(migration, /\^\[a-z0-9\]/i);
  for (const name of ['admin', 'administrator', 'donezo', 'support', 'system']) {
    assert.match(migration, new RegExp(name, 'i'));
  }
  assert.match(migration, /unique/i);
});

test('discovery stays behind bounded authenticated RPCs', () => {
  assert.match(migration, /create or replace function public\.search_people\(search_query text, result_limit integer default 20\)/i);
  assert.match(migration, /create or replace function public\.suggest_people\(result_limit integer default 10\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path\s*=\s*''/i);
  assert.match(migration, /least\(20/i);
  assert.match(migration, /length\([^)]*\)\s*<\s*2/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+public\.profiles\s+to\s+authenticated/i);
  assert.match(migration, /grant execute on function public\.search_people/i);
  assert.match(migration, /grant execute on function public\.suggest_people/i);
});

test('discovery RPC result contract exposes no private columns', () => {
  for (const column of ['user_id uuid', 'username text', 'display_name text', 'avatar_url text', 'relationship_status text', 'request_id uuid', 'mutual_count bigint']) {
    assert.match(migration, new RegExp(column.replace(' ', '\\s+'), 'i'));
  }
  assert.doesNotMatch(migration, /returns table[\s\S]{0,500}\b(email|phone|timezone|recap_awards_enabled)\b/i);
});

test('profile pending-request RLS compares friend requests to the outer profile id', () => {
  assert.match(migration, /profiles_select_friends_or_requests/i);
  assert.match(migration, /request\.requester_id\s*=\s*profiles\.id/i);
  assert.match(migration, /request\.addressee_id\s*=\s*profiles\.id/i);
  assert.doesNotMatch(migration, /request\.requester_id\s*=\s*request\.id/i);
  assert.doesNotMatch(migration, /request\.addressee_id\s*=\s*request\.id/i);
});
