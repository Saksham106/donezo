import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository } from '../src/store.js';

const seed = {
  currentUserId: 'me',
  members: [{ id: 'me', name: 'Me', xp: 0 }, { id: 'friend', name: 'Friend', xp: 0 }],
  habits: [
    { id: 'mine', circleId: 'circle-1', ownerId: 'me', title: 'Run', emoji: '🏃', frequency: 'daily', targetTime: '08:00', proofMode: 'photo', xp: 10, active: true },
    { id: 'theirs', circleId: 'circle-1', ownerId: 'friend', title: 'Read', emoji: '📚', frequency: 'daily', targetTime: '21:00', proofMode: 'none', xp: 10, active: true },
  ],
  checkIns: [{ id: 'old-check', habitId: 'mine', userId: 'me', date: '2026-08-27', completedAt: '2026-08-27T12:00:00Z' }],
  nudges: [],
};

test('owner can edit the existing daily habit fields', () => {
  const repo = createMemoryRepository(seed);
  const updated = repo.updateHabit('mine', {
    title: 'Morning run',
    emoji: '⚡',
    targetTime: '07:30',
    proofMode: 'none',
  });
  assert.equal(updated.title, 'Morning run');
  assert.equal(updated.emoji, '⚡');
  assert.equal(updated.targetTime, '07:30');
  assert.equal(updated.proofMode, 'none');
  assert.equal(updated.frequency, 'daily');
  assert.equal(updated.active, true);
});

test('habit editing validates title, target time, proof mode and emoji', () => {
  const repo = createMemoryRepository(seed);
  assert.throws(() => repo.updateHabit('mine', { title: '   ', emoji: '⚡', targetTime: '08:00', proofMode: 'photo' }), /1–80/);
  assert.throws(() => repo.updateHabit('mine', { title: 'x'.repeat(81), emoji: '⚡', targetTime: '08:00', proofMode: 'photo' }), /1–80/);
  assert.throws(() => repo.updateHabit('mine', { title: 'Run', emoji: '', targetTime: '08:00', proofMode: 'photo' }), /emoji/i);
  assert.throws(() => repo.updateHabit('mine', { title: 'Run', emoji: '⚡', targetTime: '25:00', proofMode: 'photo' }), /time/i);
  assert.throws(() => repo.updateHabit('mine', { title: 'Run', emoji: '⚡', targetTime: '08:00', proofMode: 'video' }), /proof/i);
});

test('cannot edit or archive another member habit', () => {
  const repo = createMemoryRepository(seed);
  assert.throws(() => repo.updateHabit('theirs', { title: 'Nope', emoji: '📚', targetTime: '21:00', proofMode: 'none' }), /your own habit/i);
  assert.throws(() => repo.archiveHabit('theirs'), /your own habit/i);
});

test('archiving marks the habit inactive without erasing historical check-ins', () => {
  const repo = createMemoryRepository(seed);
  repo.archiveHabit('mine');
  const state = repo.getState();
  assert.equal(state.habits.find((habit) => habit.id === 'mine').active, false);
  assert.equal(state.checkIns.some((checkIn) => checkIn.id === 'old-check'), true);
});

test('production repository scopes writes to owner and loads archived habits for history', async () => {
  const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
  assert.match(store, /async function updateHabit\(/);
  assert.match(store, /async function archiveHabit\(/);
  assert.match(store, /from\('habits'\)\.update\([\s\S]*?\.eq\('id', habitId\)\.eq\('owner_id', user\.id\)/);
  assert.doesNotMatch(store, /from\('habits'\)\.select\('\*'\)\.eq\('circle_id', circle\.id\)\.eq\('active', true\)/);
  assert.match(store, /updateHabit,\s*archiveHabit/);
});
