import test from 'node:test';
import assert from 'node:assert/strict';
import { mapDatabaseState, proofObjectPath } from '../src/store.js';

const user = { id: 'user-1', email: 'saksham@example.com' };

const rows = {
  today: '2026-08-27',
  profile: { id: 'user-1', username: 'sak', display_name: 'Saksham', avatar_url: null, timezone: 'America/New_York' },
  circle: { id: 'circle-1', name: 'Donezo Crew', invite_code: 'abc123' },
  members: [
    { user_id: 'user-1', profiles: { id: 'user-1', username: 'sak', display_name: 'Saksham', avatar_url: null, timezone: 'America/New_York' } },
    { user_id: 'user-2', profiles: { id: 'user-2', username: 'alex', display_name: 'Alex', avatar_url: null, timezone: 'Asia/Ho_Chi_Minh' } },
    { user_id: 'user-3', profiles: { id: 'user-3', username: 'bob', display_name: 'Bob', avatar_url: null, timezone: 'America/Los_Angeles' } },
  ],
  habits: [
    { id: 'habit-1', circle_id: 'circle-1', owner_id: 'user-1', title: 'Run', emoji: '🏃', frequency: 'daily', target_time: '08:00:00', proof_mode: 'photo', xp: 20, active: true, created_at: '2026-08-28T00:30:00Z' },
    { id: 'habit-2', circle_id: 'circle-1', owner_id: 'user-2', title: 'Read', emoji: '📚', frequency: 'daily', target_time: null, proof_mode: 'none', xp: 10, active: true, created_at: '2026-08-25T12:00:00Z' },
  ],
  checkIns: [
    { id: 'check-1', habit_id: 'habit-1', user_id: 'user-1', check_date: '2026-08-27', completed_at: '2026-08-27T23:55:00Z', proof_path: 'user-1/proof.webp', note: null },
    { id: 'check-2', habit_id: 'habit-2', user_id: 'user-2', check_date: '2026-08-27', completed_at: '2026-08-27T13:00:00Z', proof_path: null, note: null },
  ],
  reactions: [
    { id: 'r1', check_in_id: 'check-1', user_id: 'user-2', emoji: '👎', created_at: '2026-08-27T23:56:00Z' },
    { id: 'r2', check_in_id: 'check-1', user_id: 'user-3', emoji: '👎', created_at: '2026-08-27T23:57:00Z' },
  ],
  nudges: [],
};

test('mapDatabaseState maps timezones, reactions, invalid proof and all activity', () => {
  const state = mapDatabaseState(user, rows);
  assert.equal(state.currentUserId, 'user-1');
  assert.equal(state.circleName, 'Donezo Crew');
  assert.equal(state.circleInviteCode, 'abc123');
  assert.equal(state.members[0].timeZone, 'America/New_York');
  assert.equal(state.habits[0].ownerTimeZone, 'America/New_York');
  assert.equal(state.habits[0].createdDate, '2026-08-27');
  assert.equal(state.checkIns[0].proofPath, 'user-1/proof.webp');
  assert.equal(state.checkIns[0].invalid, true);
  assert.equal(state.checkIns[0].downvotes, 2);
  assert.equal(state.members[0].currentStreak, 0);
  assert.equal(state.members[1].currentStreak, 1);
  assert.equal(state.friendActivities.length, 2);
  assert.equal(state.friendActivities.some((activity) => activity.userId === 'user-1'), true);
  assert.equal(state.reactions.length, 2);
});

test('mapDatabaseState ignores check-ins outside the loaded circle habits', () => {
  const state = mapDatabaseState(user, {
    ...rows,
    checkIns: [
      ...rows.checkIns,
      { id: 'other-circle-check', habit_id: 'other-habit', user_id: 'user-2', check_date: '2026-08-27', completed_at: '2026-08-27T13:00:00Z', proof_path: null, note: null },
    ],
  });
  assert.equal(state.checkIns.length, 2);
  assert.equal(state.friendActivities.length, 2);
});

test('proofObjectPath keeps uploads inside the authenticated user folder', () => {
  const path = proofObjectPath('user-1', 'habit-1', 'image/jpeg', 1720000000000);
  assert.equal(path, 'user-1/habit-1-1720000000000.jpg');
});

test('proofObjectPath rejects unsupported image types', () => {
  assert.throws(() => proofObjectPath('user-1', 'habit-1', 'image/gif', 1), /Unsupported image type/);
});
