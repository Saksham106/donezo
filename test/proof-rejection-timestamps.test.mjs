import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapDatabaseState } from '../src/store.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

const user = { id: 'owner', email: 'owner@example.com' };
const rows = {
  today: '2026-09-02',
  profile: { id: 'owner', display_name: 'Owner', username: 'owner', timezone: 'America/New_York' },
  members: [
    { user_id: 'owner', profiles: { id: 'owner', display_name: 'Owner', username: 'owner', timezone: 'America/New_York' } },
    { user_id: 'friend-a', profiles: { id: 'friend-a', display_name: 'A', username: 'a', timezone: 'America/New_York' } },
    { user_id: 'friend-b', profiles: { id: 'friend-b', display_name: 'B', username: 'b', timezone: 'America/New_York' } },
  ],
  habits: [{
    id: 'habit', circle_id: 'circle', owner_id: 'owner', title: 'Lift', emoji: '🏋️', frequency: 'daily',
    target_time: '18:00:00', proof_mode: 'photo', xp: 20, active: true, created_at: '2026-09-01T12:00:00Z',
  }],
  checkIns: [{
    id: 'proof', habit_id: 'habit', user_id: 'owner', check_date: '2026-09-02',
    completed_at: '2026-09-02T12:14:00Z', proof_path: 'owner/proof.webp', note: null,
  }],
  reactions: [{ id: 'reject-1', check_in_id: 'proof', user_id: 'friend-a', emoji: '👎', created_at: '2026-09-02T12:15:00Z' }],
  checkInAudienceMembers: [{ check_in_id: 'proof', viewer_id: 'owner' }],
  checkInAudienceSizes: [{ check_in_id: 'proof', audience_size: 3 }],
  nudges: [],
};

test('proof state exposes immutable audience size to the proof card', () => {
  const state = mapDatabaseState(user, rows);
  const checkIn = state.checkIns.find((item) => item.id === 'proof');
  const activity = state.friendActivities.find((item) => item.checkInId === 'proof');
  assert.equal(checkIn.audienceSize, 3);
  assert.equal(activity.audienceSize, 3);
  assert.equal(checkIn.downvotes, 1);
  assert.equal(checkIn.invalid, false, 'one of two eligible peers is not a majority');
});

test('proof cards use the immutable audience for rejection threshold and show owner rejection status', () => {
  assert.match(app, /proofRejectionThreshold\(activity\.audienceSize\)/);
  assert.match(app, /const rejectionStatus =/);
  assert.match(app, /mine[\s\S]*rejectionStatus/);
});

test('proof activity metadata includes relative and exact local time', () => {
  assert.match(app, /function formatExactTime\(value\)/);
  assert.match(app, /formatWhen\(activity\.when\)[\s\S]*formatExactTime\(activity\.when\)/);
});
