import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUDIENCES,
  canonicalFriendPair,
  directFriendIds,
  normalizeAudience,
  snapshotAuthorizedViewers,
  canViewSnapshot,
  personalizedLeagueMemberIds,
} from '../src/friends-domain.js';
import { rejectedCheckInIds } from '../src/domain.js';
import { createMemoryRepository } from '../src/store.js';

const migration = await readFile(new URL('../supabase/migrations/0021_friends_audiences.sql', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');

const seed = {
  currentUserId: 'me',
  profiles: [
    { id: 'me', name: 'Me' },
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'stranger', name: 'Stranger' },
  ],
  friendships: [{ user_a: 'alice', user_b: 'me' }],
  friendRequests: [],
  habits: [{ id: 'h1', ownerId: 'me', title: 'Run', emoji: '🏃', xp: 10, proofMode: 'none', active: true, audience: 'selected_friends', selectedFriendIds: ['alice'] }],
  checkIns: [],
  members: [{ id: 'me', name: 'Me', xp: 0 }],
  nudges: [],
};

test('audience helpers fail closed and preserve direct friend semantics', () => {
  assert.deepEqual(canonicalFriendPair('z', 'a'), ['a', 'z']);
  assert.deepEqual([...directFriendIds('me', seed.friendships)], ['alice']);
  assert.equal(normalizeAudience('only_me', []), 'only_me');
  assert.throws(() => normalizeAudience('selected_friends', ['stranger'], 'me', seed.friendships), /direct friends/);
  assert.throws(() => normalizeAudience('all_friends', ['alice'], 'me', seed.friendships), /must not include/);
});

test('check-in viewer snapshots are fixed at creation and do not expand later', () => {
  const snapshot = snapshotAuthorizedViewers({ ownerId: 'me', audience: 'all_friends' }, seed.friendships);
  assert.deepEqual(snapshot, ['alice', 'me']);
  assert.equal(canViewSnapshot('alice', snapshot), true);
  assert.equal(canViewSnapshot('bob', snapshot), false);
  const afterFriendship = [...seed.friendships, { user_a: 'bob', user_b: 'me' }];
  assert.equal(canViewSnapshot('bob', snapshot), false);
  assert.deepEqual(snapshotAuthorizedViewers({ ownerId: 'me', audience: 'only_me' }, afterFriendship), ['me']);
});

test('personalized league contains only current user and direct friends', () => {
  assert.deepEqual(personalizedLeagueMemberIds('me', seed.friendships, seed.profiles), ['alice', 'me']);
  assert.equal(personalizedLeagueMemberIds('stranger', seed.friendships, seed.profiles).includes('alice'), false);
});

test('proof rejection threshold is calculated per immutable audience snapshot', () => {
  const checkIns = [{ id: 'proof', proofPath: 'proof.jpg', userId: 'owner' }];
  const reactions = [{ checkInId: 'proof', userId: 'friend-a', emoji: '👎' }];
  assert.deepEqual([...rejectedCheckInIds(checkIns, reactions, 5, new Map([['proof', 2]]))], ['proof']);
  assert.deepEqual([...rejectedCheckInIds(checkIns, reactions, 5, new Map([['proof', 4]]))], []);
});

test('memory repository invites and accepts a direct friend without circle switching', () => {
  const repo = createMemoryRepository({ ...seed, friendships: [], members: seed.profiles.map((profile) => ({ ...profile, xp: 0 })) });
  const request = repo.inviteFriend('alice');
  assert.equal(request.status, 'pending');
  assert.throws(() => repo.acceptFriend(request.id), /recipient/);
  repo.asUser('alice');
  const accepted = repo.acceptFriend(request.id);
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(repo.getFriendIds(), ['me']);
  repo.asUser('me');
  repo.setHabitAudience('h1', 'all_friends');
  repo.completeWithProof('h1', '2026-08-30');
  assert.deepEqual(repo.getUnifiedFeed().map((item) => item.id), [repo.getState().checkIns[0].id]);
  repo.asUser('alice');
  assert.equal(repo.getUnifiedFeed().length, 1);
  repo.asUser('bob');
  assert.equal(repo.getUnifiedFeed().length, 0);
});

test('memory repository snapshots selected viewers and keeps league personalized', () => {
  const repo = createMemoryRepository({ ...seed, members: [...seed.members, { id: 'bob', name: 'Bob', xp: 0 }] });
  repo.completeWithProof('h1', '2026-08-30');
  const checkIn = repo.getState().checkIns[0];
  assert.deepEqual(checkIn.authorizedViewerIds, ['alice', 'me']);
  repo.addFriendForTest('bob');
  repo.asUser('bob');
  assert.equal(repo.getUnifiedFeed().length, 0);
  assert.deepEqual(repo.getPersonalizedLeague().map((member) => member.id), ['bob', 'me']);
});

test('memory replies are authorized by the check-in snapshot rather than a circle', () => {
  const repo = createMemoryRepository(seed);
  repo.completeWithProof('h1', '2026-08-30');
  const checkInId = repo.getState().checkIns[0].id;
  repo.asUser('alice');
  const reply = repo.addComment(checkInId, 'Keep going');
  assert.equal(reply.circleId, null);
  repo.asUser('bob');
  assert.throws(() => repo.addComment(checkInId, 'No access'), /not visible/);
  repo.asUser('alice');
  assert.doesNotThrow(() => repo.deleteComment(reply.id));
});

test('repository adapters expose friend, audience, feed, and personalized league operations', () => {
  for (const operation of ['loadFriends', 'inviteFriend', 'acceptFriend', 'setHabitAudience', 'loadUnifiedFeed', 'loadPersonalizedLeague']) {
    assert.match(storeSource, new RegExp(`function ${operation}`));
  }
  assert.match(storeSource, /rpc\('invite_friend'/);
  assert.match(storeSource, /rpc\('accept_friend'/);
  assert.match(storeSource, /rpc\('set_habit_audience'/);
  assert.match(storeSource, /from\('friendships'\)/);
  assert.match(storeSource, /from\('check_ins'\)/);
});
test('0021 defines direct friend RPCs, immutable viewer snapshots, and all required RLS boundaries', () => {
  for (const table of ['profiles', 'habits', 'check_ins', 'reactions', 'check_in_comments', 'friendships', 'friend_requests', 'friend_labels', 'check_in_audience_members']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /create policy proof_objects_select_authorized_viewer[\s\S]*on storage\.objects for select/i);
  assert.match(migration, /create table if not exists public\.friendships/i);
  assert.match(migration, /create table if not exists public\.friend_requests/i);
  assert.match(migration, /create table if not exists public\.check_in_audience_members/i);
  assert.match(migration, /alter table public\.habits[\s\S]*add column if not exists audience/i);
  assert.match(migration, /selected_friend_ids uuid\[\]/i);
  assert.match(migration, /create or replace function public\.invite_friend/i);
  assert.match(migration, /create or replace function public\.accept_friend/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /insert into public\.friendships/i);
  assert.match(migration, /check_in_audience_members.*viewer_id/i);
  assert.match(migration, /proof_objects_select_authorized_viewer/i);
  assert.match(migration, /reactions_select_authorized_viewer/i);
  assert.match(migration, /check_in_comments_select_authorized_viewer/i);
  assert.match(migration, /join public\.check_in_audience_members viewer[\s\S]*reaction\.user_id = viewer\.viewer_id/i);
  assert.match(migration, /count\(\*\) from public\.check_in_audience_members/i);
  assert.match(migration, /delete from public\.check_in_comments (?:reply|comment)[\s\S]*\.(?:author_id) = actor[\s\S]*check_in_audience_members/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.add_check_in_comment[\s\S]*?revoke all on function public\.add_check_in_comment/i)?.[0] || '', /habit\.circle_id|target_circle/i);
  assert.doesNotMatch(migration, /grant all on table public\.(friendships|friend_requests|check_in_audience_members)/i);
});

test('0021 backfills co-members and current visibility without future friend expansion', () => {
  assert.match(migration, /insert into public\.friendships[\s\S]*circle_members[\s\S]*on conflict/i);
  assert.match(migration, /update public\.habits[\s\S]*selected_friend_ids/i);
  assert.match(migration, /insert into public\.check_in_audience_members[\s\S]*public\.habit_circles/i);
  assert.match(migration, /create or replace function private\.snapshot_check_in_audience_members/i);
  assert.match(migration, /after insert on public\.check_ins/i);
  assert.match(migration, /private\.habit_visible_to_current_user/i);
  assert.match(migration, /private\.can_view_proof[\s\S]*check_in_audience_members/i);
});
