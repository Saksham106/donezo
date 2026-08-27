import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyProgress, calculateStreak, rankMembers } from '../src/domain.js';

test('dailyProgress returns completed ratio and percentage', () => {
  assert.deepEqual(dailyProgress(3, 5), { completed: 3, total: 5, ratio: 0.6, percent: 60 });
});

test('calculateStreak counts consecutive completed days ending today', () => {
  const dates = ['2026-08-27', '2026-08-26', '2026-08-25', '2026-08-23'];
  assert.equal(calculateStreak(dates, '2026-08-27'), 3);
});

test('rankMembers sorts highest XP first and assigns ranks', () => {
  const ranked = rankMembers([
    { id: 'a', name: 'A', xp: 120 },
    { id: 'b', name: 'B', xp: 310 },
    { id: 'c', name: 'C', xp: 200 },
  ]);
  assert.deepEqual(ranked.map(({ id, rank }) => ({ id, rank })), [
    { id: 'b', rank: 1 },
    { id: 'c', rank: 2 },
    { id: 'a', rank: 3 },
  ]);
});
