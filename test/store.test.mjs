import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/store.js';

const seed = {
  currentUserId: 'me',
  members: [{ id: 'me', name: 'Me', xp: 100 }, { id: 'friend', name: 'Friend', xp: 0 }],
  profiles: [{ id: 'me', name: 'Me', xp: 100 }, { id: 'friend', name: 'Friend', xp: 0 }],
  friendships: [{ user_a: 'friend', user_b: 'me' }],
  habits: [{ id: 'h1', ownerId: 'me', title: 'Run', emoji: '🏃', xp: 10, proofMode: 'none', active: true }],
  checkIns: [],
  nudges: [],
};

test('toggleHabit creates then removes today check-in', () => {
  const repo = createMemoryRepository(seed);
  repo.toggleHabit('h1', '2026-08-27');
  assert.equal(repo.getState().checkIns.length, 1);
  assert.equal(repo.getState().checkIns[0].completedQuantity, 1);
  assert.equal(repo.getState().members[0].xp, 110);
  repo.toggleHabit('h1', '2026-08-27');
  assert.equal(repo.getState().checkIns.length, 0);
  assert.equal(repo.getState().members[0].xp, 100);
});

test('addHabit adds an active habit owned by current user', () => {
  const repo = createMemoryRepository(seed);
  const habit = repo.addHabit({ title: 'Read', emoji: '📚', xp: 15, proofMode: 'photo', targetTime: '21:00' });
  assert.equal(repo.getState().habits.length, 2);
  assert.equal(habit.ownerId, 'me');
  assert.equal(habit.active, true);
});

test('sendNudge records a nudge to a friend', () => {
  const repo = createMemoryRepository(seed);
  repo.sendNudge('friend', 'get moving 💀');
  assert.equal(repo.getState().nudges[0].toUserId, 'friend');
  assert.equal(repo.getState().nudges[0].message, 'get moving 💀');
});

test('setBatonEnabled stores the inverse opt-out preference', () => {
  const repo = createMemoryRepository(seed);
  repo.setBatonEnabled(false);
  assert.equal(repo.getState().batonOptedOut, true);
  assert.equal(repo.getState().members[0].batonOptedOut, true);
  repo.setBatonEnabled(true);
  assert.equal(repo.getState().batonOptedOut, false);
  assert.equal(repo.getState().members[0].batonOptedOut, false);
});
