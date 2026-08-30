import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository } from '../src/store.js';
import { validateInviteCode } from '../src/invite.js';

const migration = await readFile(new URL('../supabase/migrations/0022_friend_invite_hardening.sql', import.meta.url), 'utf8').catch(() => '');
const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');

const seed = {
  currentUserId: 'me',
  profiles: [{ id: 'me', name: 'Me' }, { id: 'friend', name: 'Friend' }],
  friendships: [],
  friendRequests: [],
  members: [{ id: 'me', name: 'Me', xp: 0 }, { id: 'friend', name: 'Friend', xp: 0 }],
  habits: [],
  checkIns: [],
  nudges: [],
};

test('new friend invite codes carry at least 96 bits of CSPRNG entropy', () => {
  assert.match(migration, /encode\(extensions\.gen_random_bytes\(12\),\s*'hex'\)/i);
  assert.match(migration, /code !~ '\^\(\[a-z0-9\]\{12\}\|\[a-f0-9\]\{24\}\)\$'/i);
  assert.match(migration, /code_hash = md5\(code\)/i);
});

test('client accepts hardened friend codes while preserving legacy 12-character links', () => {
  assert.equal(validateInviteCode('abcdef0123456789abcdef01').valid, true);
  assert.equal(validateInviteCode('abcdef012345').valid, true);
  assert.match(storeSource, /\^\(\?:\[a-z0-9\]\{12\}\|\[a-f0-9\]\{24\}\)\$/);
  assert.match(appSource, /maxlength="24"/);
  assert.doesNotMatch(appSource, /Paste the 12-character code a friend sent you/);
});

test('new Friends spaces share a direct friend invite rather than a legacy circle code', () => {
  assert.match(appSource, /createdFriendInvite = await repo\.createFriendInvite\(\)/);
  assert.match(appSource, /redeemInvite\(repo, validation\.code\)/);
  assert.match(appSource, /function creatorInviteScreen\(\) \{\s*const code = activeInviteCode\(\)/);
  assert.match(appSource, /if \(\(createdFriendInvite \|\| createdCircleInvite\) && state\?\.circleId\) \{/);
});

test('memory repository emits hardened friend codes', () => {
  const repo = createMemoryRepository(seed);
  const invite = repo.createFriendInvite();
  assert.match(invite.code, /^[a-f0-9]{24}$/);
});

test('already-shipped RLS and no-circle compatibility fixes remain locked', async () => {
  const foundation = await readFile(new URL('../supabase/migrations/0021_friends_audiences.sql', import.meta.url), 'utf8');
  assert.match(foundation, /grant execute on function private\.are_direct_friends\(uuid, uuid\) to authenticated/i);
  assert.match(foundation, /grant execute on function private\.direct_friend_ids\(uuid\) to authenticated/i);
  assert.match(foundation, /grant execute on function private\.habit_visible_to_current_user\(uuid\) to authenticated/i);
  assert.match(foundation, /create or replace function public\.ensure_friends_workspace/i);
  assert.match(storeSource, /async function ensureFriendsWorkspace\(\)/);
  assert.doesNotMatch(storeSource, /memberProfileById\.has\(comment\.author_id\)/);
});
