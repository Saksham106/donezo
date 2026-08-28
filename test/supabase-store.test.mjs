import test from 'node:test';
import assert from 'node:assert/strict';
import { mapDatabaseState, proofObjectPath } from '../src/store.js';

const user = { id: 'user-1', email: 'saksham@example.com' };

const rows = {
  today: '2026-08-27',
  profile: { id: 'user-1', username: 'sak', display_name: 'Saksham', avatar_url: null },
  circle: { id: 'circle-1', name: 'Donezo Crew', invite_code: 'abc123' },
  members: [
    { user_id: 'user-1', profiles: { id: 'user-1', username: 'sak', display_name: 'Saksham', avatar_url: null } },
    { user_id: 'user-2', profiles: { id: 'user-2', username: 'alex', display_name: 'Alex', avatar_url: null } },
  ],
  habits: [
    { id: 'habit-1', circle_id: 'circle-1', owner_id: 'user-1', title: 'Run', emoji: '🏃', frequency: 'daily', target_time: '08:00:00', proof_mode: 'photo', xp: 20, active: true, created_at: '2026-08-26T12:00:00Z' },
    { id: 'habit-2', circle_id: 'circle-1', owner_id: 'user-2', title: 'Read', emoji: '📚', frequency: 'daily', target_time: null, proof_mode: 'none', xp: 10, active: true, created_at: '2026-08-25T12:00:00Z' },
  ],
  checkIns: [
    { id: 'check-1', habit_id: 'habit-1', user_id: 'user-1', check_date: '2026-08-27', completed_at: '2026-08-27T12:00:00Z', proof_path: 'user-1/proof.webp', note: null },
  ],
  nudges: [],
};

test('mapDatabaseState converts Supabase rows into app state and derives XP', () => {
  const state = mapDatabaseState(user, rows);
  assert.equal(state.currentUserId, 'user-1');
  assert.equal(state.circleName, 'Donezo Crew');
  assert.equal(state.circleInviteCode, 'abc123');
  assert.deepEqual(state.members.map(({ id, name, xp }) => ({ id, name, xp })), [
    { id: 'user-1', name: 'Saksham', xp: 20 },
    { id: 'user-2', name: 'Alex', xp: 0 },
  ]);
  assert.equal(state.habits[0].proofMode, 'photo');
  assert.equal(state.habits[0].createdAt, '2026-08-26T12:00:00Z');
  assert.equal(state.checkIns[0].proofPath, 'user-1/proof.webp');
  assert.equal(state.members[0].currentStreak, 1);
  assert.equal(state.members[0].bestStreak, 1);
});

test('mapDatabaseState ignores check-ins outside the loaded circle habits', () => {
  const state = mapDatabaseState(user, {
    ...rows,
    checkIns: [
      ...rows.checkIns,
      { id: 'other-circle-check', habit_id: 'other-habit', user_id: 'user-2', check_date: '2026-08-27', completed_at: '2026-08-27T13:00:00Z', proof_path: null, note: null },
    ],
  });
  assert.equal(state.checkIns.length, 1);
  assert.equal(state.friendActivities.length, 0);
});

test('proofObjectPath keeps uploads inside the authenticated user folder', () => {
  const path = proofObjectPath('user-1', 'habit-1', 'image/jpeg', 1720000000000);
  assert.equal(path, 'user-1/habit-1-1720000000000.jpg');
});

test('proofObjectPath rejects unsupported image types', () => {
  assert.throws(() => proofObjectPath('user-1', 'habit-1', 'image/gif', 1), /Unsupported image type/);
});
