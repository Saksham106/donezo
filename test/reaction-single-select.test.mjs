import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/store.js';

function repository() {
  return createMemoryRepository({
    currentUserId: 'me',
    circleId: 'circle-1',
    members: [
      { id: 'me', name: 'Me', timeZone: 'America/New_York' },
      { id: 'friend', name: 'Friend', timeZone: 'America/New_York' },
    ],
    habits: [
      { id: 'habit', ownerId: 'friend', circleId: 'circle-1', title: 'Run', emoji: '🏃', frequency: 'daily', active: true, xp: 10 },
    ],
    checkIns: [
      { id: 'check', habitId: 'habit', userId: 'friend', date: '2026-08-31', proofPath: 'friend/run.jpg', completedAt: '2026-08-31T12:00:00Z' },
    ],
    reactions: [
      { id: 'reject', checkInId: 'check', userId: 'me', emoji: '👎', createdAt: '2026-08-31T12:01:00Z' },
    ],
    comments: [],
    nudges: [],
    challenges: [],
    stakes: [],
    recoveries: [],
    batonHandoffs: [],
  });
}

test('selecting a different positive proof reaction replaces the old one and preserves rejection vote', () => {
  const repo = repository();

  repo.toggleReaction('check', '🔥');
  repo.toggleReaction('check', '👏');

  const mine = repo.getState().reactions.filter((reaction) => reaction.checkInId === 'check' && reaction.userId === 'me');
  assert.deepEqual(mine.map((reaction) => reaction.emoji).sort(), ['👏', '👎'].sort());
});

test('tapping the selected positive proof reaction removes it without touching rejection vote', () => {
  const repo = repository();

  repo.toggleReaction('check', '🔥');
  repo.toggleReaction('check', '🔥');

  const mine = repo.getState().reactions.filter((reaction) => reaction.checkInId === 'check' && reaction.userId === 'me');
  assert.deepEqual(mine.map((reaction) => reaction.emoji), ['👎']);
});
