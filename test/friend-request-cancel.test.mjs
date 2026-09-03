import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createMemoryRepository } from '../src/store.js';

const migrationUrl = new URL('../supabase/migrations/20260903022500_cancel_friend_request.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

function functionBlock(source, name, next = '\n  async function ') {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `missing async function ${name}`);
  let end = source.indexOf(next, start + 1);
  if (end < 0) end = source.length;
  return source.slice(start, end);
}

test('cancel friend request RPC is requester-only and pending-only', () => {
  assert.match(migration, /create or replace function public\.cancel_friend_request\(target_request_id uuid\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path\s*=\s*''/i);
  assert.match(migration, /request\.id\s*=\s*target_request_id/i);
  assert.match(migration, /request\.requester_id\s*=\s*actor/i);
  assert.match(migration, /request\.status\s*=\s*'pending'/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /status\s*=\s*'cancelled'/i);
  assert.match(migration, /responded_at\s*=\s*now\(\)/i);
  assert.match(migration, /revoke all on function public\.cancel_friend_request\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.cancel_friend_request\(uuid\) to authenticated/i);
});

test('production repository cancels without a full reload and patches friendRequests locally', () => {
  const body = functionBlock(store, 'cancelFriendRequest');
  assert.match(body, /rpc\('cancel_friend_request', \{ target_request_id: requestId \}\)/);
  assert.match(body, /state\.friendRequests/);
  assert.match(body, /status:\s*'cancelled'/);
  assert.doesNotMatch(body, /await load\(/);
});

const seed = {
  currentUserId: 'me',
  profiles: [
    { id: 'me', name: 'Me' },
    { id: 'friend', name: 'Friend' },
    { id: 'other', name: 'Other' },
  ],
  members: [{ id: 'me', name: 'Me' }],
  friendships: [],
  friendRequests: [
    { id: 'mine', requesterId: 'me', addresseeId: 'friend', status: 'pending' },
    { id: 'theirs', requesterId: 'other', addresseeId: 'me', status: 'pending' },
    { id: 'closed', requesterId: 'me', addresseeId: 'other', status: 'accepted', respondedAt: '2026-09-01T00:00:00Z' },
  ],
  habits: [],
  checkIns: [],
  nudges: [],
};

test('memory cancellation mirrors requester and terminal-state authorization', () => {
  const repo = createMemoryRepository(seed);
  assert.equal(typeof repo.cancelFriendRequest, 'function');
  const cancelled = repo.cancelFriendRequest('mine');
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.respondedAt);
  assert.equal(repo.getState().friendRequests.find((request) => request.id === 'mine').status, 'cancelled');
  assert.throws(() => repo.cancelFriendRequest('theirs'), /not open/i);
  assert.throws(() => repo.cancelFriendRequest('closed'), /not open/i);
});
