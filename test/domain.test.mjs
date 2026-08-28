import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyProgress, calculateBestStreak, calculateStreak, rankMembers, weeklyCompletionScore, rankMembersByWeeklyScore } from '../src/domain.js';

test('dailyProgress returns completed ratio and percentage', () => {
  assert.deepEqual(dailyProgress(3, 5), { completed: 3, total: 5, ratio: 0.6, percent: 60 });
});

test('calculateStreak counts consecutive completed days ending today', () => {
  const dates = ['2026-08-27', '2026-08-26', '2026-08-25', '2026-08-23'];
  assert.equal(calculateStreak(dates, '2026-08-27'), 3);
});

test('calculateBestStreak finds the longest consecutive run', () => {
  const dates = ['2026-08-20', '2026-08-21', '2026-08-23', '2026-08-24', '2026-08-25'];
  assert.equal(calculateBestStreak(dates), 3);
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

test('weeklyCompletionScore weights every eligible commitment equally and starts new habits on creation date', () => {
  const habits = [
    { id: 'h1', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-24T10:00:00Z' },
    { id: 'h2', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-26T10:00:00Z' },
  ];
  const checkIns = [
    { habitId: 'h1', userId: 'a', date: '2026-08-24' },
    { habitId: 'h1', userId: 'a', date: '2026-08-25' },
    { habitId: 'h1', userId: 'a', date: '2026-08-26' },
    { habitId: 'h2', userId: 'a', date: '2026-08-26' },
    { habitId: 'h2', userId: 'a', date: '2026-08-27' },
  ];
  assert.deepEqual(weeklyCompletionScore('a', habits, checkIns, '2026-08-27'), {
    completed: 5,
    possible: 6,
    percent: 83,
  });
});

test('weeklyCompletionScore gives the same perfect score regardless of habit count', () => {
  const habits = [
    { id: 'a1', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z' },
    { id: 'b1', ownerId: 'b', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z' },
    { id: 'b2', ownerId: 'b', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z' },
  ];
  const checkIns = [
    { habitId: 'a1', userId: 'a', date: '2026-08-27' },
    { habitId: 'b1', userId: 'b', date: '2026-08-27' },
    { habitId: 'b2', userId: 'b', date: '2026-08-27' },
  ];
  assert.equal(weeklyCompletionScore('a', habits, checkIns, '2026-08-27').percent, 100);
  assert.equal(weeklyCompletionScore('b', habits, checkIns, '2026-08-27').percent, 100);
});

test('rankMembersByWeeklyScore breaks equal scores by streak then name', () => {
  const members = [
    { id: 'a', name: 'Alex', currentStreak: 2 },
    { id: 'b', name: 'Bob', currentStreak: 5 },
    { id: 'c', name: 'Cara', currentStreak: 5 },
  ];
  const habits = members.map((member) => ({ id: `${member.id}1`, ownerId: member.id, active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z' }));
  const checkIns = habits.map((habit) => ({ habitId: habit.id, userId: habit.ownerId, date: '2026-08-27' }));
  const ranked = rankMembersByWeeklyScore(members, habits, checkIns, '2026-08-27');
  assert.deepEqual(ranked.map(({ id, rank, weeklyScore }) => ({ id, rank, weeklyScore })), [
    { id: 'b', rank: 1, weeklyScore: 100 },
    { id: 'c', rank: 2, weeklyScore: 100 },
    { id: 'a', rank: 3, weeklyScore: 100 },
  ]);
});
