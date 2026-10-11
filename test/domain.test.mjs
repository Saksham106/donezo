import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyProgress,
  dailyAccountabilitySummary,
  calculateBestStreak,
  calculateStreak,
  calculateHabitStreak,
  rankMembers,
  weeklyCompletionScore,
  rankMembersByWeeklyScore,
  localDateInTimeZone,
  accountabilityDateForMember,
  proofRejectionThreshold,
  rejectedCheckInIds,
} from '../src/domain.js';

test('dailyProgress returns completed ratio and percentage', () => {
  assert.deepEqual(dailyProgress(3, 5), { completed: 3, total: 5, ratio: 0.6, percent: 60 });
});

test('dailyAccountabilitySummary exposes today work and exact yesterday misses', () => {
  const habits = [
    { id: 'gym', ownerId: 'a', title: 'Gym', emoji: '🏋️', active: true, frequency: 'daily', targetQuantity: 1, createdDate: '2026-08-20' },
    { id: 'run', ownerId: 'a', title: 'Run', emoji: '🏃', active: true, frequency: 'daily', targetQuantity: 2, createdDate: '2026-08-20' },
    { id: 'new', ownerId: 'a', title: 'New habit', emoji: '✨', active: true, frequency: 'daily', createdDate: '2026-08-30' },
  ];
  const checkIns = [
    { habitId: 'gym', userId: 'a', date: '2026-08-30', completedQuantity: 1 },
    { habitId: 'run', userId: 'a', date: '2026-08-30', completedQuantity: 1 },
    { habitId: 'run', userId: 'a', date: '2026-08-29', completedQuantity: 2, invalid: true },
  ];
  const result = dailyAccountabilitySummary('a', habits, checkIns, '2026-08-30');
  assert.deepEqual(result.today, {
    completed: 1,
    total: 3,
    percent: 33,
    remaining: [
      { id: 'run', title: 'Run', emoji: '🏃' },
      { id: 'new', title: 'New habit', emoji: '✨' },
    ],
  });
  assert.deepEqual(result.yesterday, {
    date: '2026-08-29',
    completed: 0,
    total: 2,
    missed: [
      { id: 'gym', title: 'Gym', emoji: '🏋️' },
      { id: 'run', title: 'Run', emoji: '🏃' },
    ],
  });
});

test('calculateStreak counts consecutive completed days ending today', () => {
  const dates = ['2026-08-27', '2026-08-26', '2026-08-25', '2026-08-23'];
  assert.equal(calculateStreak(dates, '2026-08-27'), 3);
});

test('calculateHabitStreak counts completed scheduled occurrences without penalizing off days or an open today', () => {
  const habit = {
    id: 'run', ownerId: 'me', active: true, scheduleFrequency: 'selected_weekdays',
    scheduleWeekdays: [1, 3, 5], targetQuantity: 1, createdDate: '2026-08-24',
    scheduleTimezone: 'UTC',
  };
  const checkIns = [
    { habitId: 'run', userId: 'me', date: '2026-08-28' },
    { habitId: 'run', userId: 'me', date: '2026-08-31' },
    { habitId: 'run', userId: 'me', date: '2026-09-02' },
  ];
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-03'), { count: 3, unit: 'check-in' });
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-04'), { count: 3, unit: 'check-in' });
});

test('calculateHabitStreak requires full quantity and ignores invalid proof', () => {
  const habit = {
    id: 'read', ownerId: 'me', active: true, scheduleFrequency: 'daily',
    targetQuantity: 3, createdDate: '2026-09-01', scheduleTimezone: 'UTC',
  };
  const checkIns = [
    { habitId: 'read', userId: 'me', date: '2026-09-01', completedQuantity: 3 },
    { habitId: 'read', userId: 'me', date: '2026-09-02', completedQuantity: 2 },
    { habitId: 'read', userId: 'me', date: '2026-09-02', completedQuantity: 1, invalid: true },
  ];
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-03'), { count: 0, unit: 'check-in' });
});

test('calculateHabitStreak treats flexible goals as consecutive successful weeks', () => {
  const habit = {
    id: 'gym', ownerId: 'me', active: true, scheduleFrequency: 'times_per_week',
    weeklyTargetDays: 3, targetQuantity: 1, createdDate: '2026-08-10', scheduleTimezone: 'UTC',
  };
  const checkIns = [
    ...['2026-08-24', '2026-08-26', '2026-08-28', '2026-08-31', '2026-09-02', '2026-09-04']
      .map((date) => ({ habitId: 'gym', userId: 'me', date })),
    { habitId: 'gym', userId: 'me', date: '2026-09-07' },
  ];
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-10'), { count: 2, unit: 'week' });
  checkIns.push(
    { habitId: 'gym', userId: 'me', date: '2026-09-09' },
    { habitId: 'gym', userId: 'me', date: '2026-09-10' },
  );
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-10'), { count: 3, unit: 'week' });
});

test('calculateHabitStreak resets its unit window when a habit switches between flexible and fixed schedules', () => {
  const habit = {
    id: 'gym', ownerId: 'me', active: true, scheduleFrequency: 'daily',
    targetQuantity: 1, createdDate: '2026-08-10', scheduleTimezone: 'UTC',
    scheduleVersions: [
      { version: 1, effectiveFrom: '2026-08-10', effectiveUntil: '2026-09-07', frequency: 'times_per_week', weeklyTargetDays: 3, targetQuantity: 1, timezone: 'UTC' },
      { version: 2, effectiveFrom: '2026-09-07', effectiveUntil: null, frequency: 'daily', targetQuantity: 1, timezone: 'UTC' },
    ],
  };
  const checkIns = ['2026-08-31', '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-08']
    .map((date) => ({ habitId: 'gym', userId: 'me', date }));
  assert.deepEqual(calculateHabitStreak(habit, checkIns, '2026-09-09'), { count: 2, unit: 'check-in' });
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

test('localDateInTimeZone keeps late-evening Boston creation on the correct local day', () => {
  assert.equal(localDateInTimeZone('2026-08-28T00:30:00Z', 'America/New_York'), '2026-08-27');
});

test('accountabilityDateForMember uses each friend’s own calendar day', () => {
  const instant = new Date('2026-08-31T00:30:00Z');
  assert.equal(accountabilityDateForMember({ timeZone: 'America/Los_Angeles' }, instant), '2026-08-30');
  assert.equal(accountabilityDateForMember({ timeZone: 'Asia/Tokyo' }, instant), '2026-08-31');
  assert.equal(accountabilityDateForMember({ timeZone: 'Not/AZone' }, instant), '2026-08-31');
});

test('proofRejectionThreshold requires a strict majority of other circle members', () => {
  assert.equal(proofRejectionThreshold(1), Infinity);
  assert.equal(proofRejectionThreshold(2), 1);
  assert.equal(proofRejectionThreshold(3), 2);
  assert.equal(proofRejectionThreshold(4), 2);
  assert.equal(proofRejectionThreshold(5), 3);
});

test('rejectedCheckInIds ignores self votes and rejects only uploaded proofs at majority threshold', () => {
  const checkIns = [
    { id: 'c1', userId: 'a', proofPath: 'a/proof.jpg' },
    { id: 'c2', userId: 'b', proofPath: null },
  ];
  const reactions = [
    { checkInId: 'c1', userId: 'a', emoji: '👎' },
    { checkInId: 'c1', userId: 'b', emoji: '👎' },
    { checkInId: 'c1', userId: 'c', emoji: '👎' },
    { checkInId: 'c2', userId: 'a', emoji: '👎' },
    { checkInId: 'c2', userId: 'c', emoji: '👎' },
  ];
  assert.deepEqual([...rejectedCheckInIds(checkIns, reactions, 3)], ['c1']);
});

test('weeklyCompletionScore weights every eligible commitment equally and starts new habits on creation date', () => {
  const habits = [
    { id: 'h1', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-24T10:00:00Z', ownerTimeZone: 'America/New_York' },
    { id: 'h2', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-26T10:00:00Z', ownerTimeZone: 'America/New_York' },
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

test('weeklyCompletionScore fixes the UTC midnight creation bug and ignores invalid proof', () => {
  const habits = [
    { id: 'h1', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-28T00:30:00Z', ownerTimeZone: 'America/New_York' },
  ];
  const checkIns = [
    { id: 'good', habitId: 'h1', userId: 'a', date: '2026-08-27', invalid: false },
  ];
  assert.deepEqual(weeklyCompletionScore('a', habits, checkIns, '2026-08-27'), { completed: 1, possible: 1, percent: 100 });
  assert.deepEqual(weeklyCompletionScore('a', habits, [{ ...checkIns[0], invalid: true }], '2026-08-27'), { completed: 0, possible: 1, percent: 0 });
});

test('weeklyCompletionScore requires the full quantity target', () => {
  const habits = [{
    id: 'read', ownerId: 'a', active: true, frequency: 'daily', createdDate: '2026-08-24', targetQuantity: 3,
  }];
  assert.deepEqual(weeklyCompletionScore('a', habits, [
    { habitId: 'read', userId: 'a', date: '2026-08-24', completedQuantity: 1 },
  ], '2026-08-24'), { completed: 0, possible: 1, percent: 0 });
  assert.deepEqual(weeklyCompletionScore('a', habits, [
    { habitId: 'read', userId: 'a', date: '2026-08-24', completedQuantity: 3 },
  ], '2026-08-24'), { completed: 1, possible: 1, percent: 100 });
});

test('weeklyCompletionScore gives the same perfect score regardless of habit count', () => {
  const habits = [
    { id: 'a1', ownerId: 'a', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z', ownerTimeZone: 'UTC' },
    { id: 'b1', ownerId: 'b', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z', ownerTimeZone: 'UTC' },
    { id: 'b2', ownerId: 'b', active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z', ownerTimeZone: 'UTC' },
  ];
  const checkIns = [
    { habitId: 'a1', userId: 'a', date: '2026-08-27' },
    { habitId: 'b1', userId: 'b', date: '2026-08-27' },
    { habitId: 'b2', userId: 'b', date: '2026-08-27' },
  ];
  assert.equal(weeklyCompletionScore('a', habits, checkIns, '2026-08-27').percent, 100);
  assert.equal(weeklyCompletionScore('b', habits, checkIns, '2026-08-27').percent, 100);
});

test('weeklyCompletionScore preserves an archived habit through its archive date', () => {
  const habits = [{
    id: 'archived-run',
    ownerId: 'me',
    frequency: 'daily',
    active: false,
    createdDate: '2026-08-24',
    archivedDate: '2026-08-26',
  }];
  const checkIns = [
    { habitId: 'archived-run', userId: 'me', date: '2026-08-24' },
    { habitId: 'archived-run', userId: 'me', date: '2026-08-25' },
    { habitId: 'archived-run', userId: 'me', date: '2026-08-26' },
  ];

  assert.deepEqual(weeklyCompletionScore('me', habits, checkIns, '2026-08-28'), {
    completed: 3,
    possible: 3,
    percent: 100,
  });
});

test('weeklyCompletionScore excludes habits archived before the current week', () => {
  const habits = [{
    id: 'old-habit',
    ownerId: 'me',
    frequency: 'daily',
    active: false,
    createdDate: '2026-08-01',
    archivedDate: '2026-08-20',
  }];

  assert.deepEqual(weeklyCompletionScore('me', habits, [], '2026-08-28'), {
    completed: 0,
    possible: 0,
    percent: 0,
  });
});

test('weeklyCompletionScore counts selected weekdays, weekly habits, and ignores pauses', () => {
  const habits = [
    { id: 'weekdays', ownerId: 'me', active: true, frequency: 'selected_weekdays', scheduleFrequency: 'selected_weekdays', scheduleWeekdays: [1, 3, 5], createdDate: '2026-08-24', scheduleTimezone: 'UTC', pauseWindows: [{ startDate: '2026-08-26', endDate: '2026-08-26' }] },
    { id: 'weekly', ownerId: 'me', active: true, frequency: 'weekly', scheduleFrequency: 'weekly', scheduleWeekdays: [2], createdDate: '2026-08-24', scheduleTimezone: 'UTC' },
  ];
  const checkIns = [
    { habitId: 'weekdays', userId: 'me', date: '2026-08-24' },
    { habitId: 'weekly', userId: 'me', date: '2026-08-25' },
  ];
  assert.deepEqual(weeklyCompletionScore('me', habits, checkIns, '2026-08-28'), {
    completed: 2,
    possible: 3,
    percent: 67,
  });
});

test('weeklyCompletionScore uses the schedule version active on each historical date', () => {
  const habits = [{
    id: 'versioned', ownerId: 'u1', active: true, createdDate: '2026-08-24',
    scheduleFrequency: 'selected_weekdays', scheduleWeekdays: [1], scheduleTimezone: 'UTC',
    scheduleVersions: [
      { version: 1, effectiveFrom: '2026-08-24', effectiveUntil: '2026-08-26', frequency: 'daily', weekdays: [], timezone: 'UTC' },
      { version: 2, effectiveFrom: '2026-08-26', effectiveUntil: null, frequency: 'selected_weekdays', weekdays: [1], timezone: 'UTC' },
    ],
  }];
  const checkIns = [
    { habitId: 'versioned', userId: 'u1', date: '2026-08-24' },
    { habitId: 'versioned', userId: 'u1', date: '2026-08-25' },
  ];
  assert.deepEqual(weeklyCompletionScore('u1', habits, checkIns, '2026-08-28'), { completed: 2, possible: 2, percent: 100 });
});

test('rankMembersByWeeklyScore breaks equal scores by streak then name', () => {
  const members = [
    { id: 'a', name: 'Alex', currentStreak: 2 },
    { id: 'b', name: 'Bob', currentStreak: 5 },
    { id: 'c', name: 'Cara', currentStreak: 5 },
  ];
  const habits = members.map((member) => ({ id: `${member.id}1`, ownerId: member.id, active: true, frequency: 'daily', createdAt: '2026-08-27T08:00:00Z', ownerTimeZone: 'UTC' }));
  const checkIns = habits.map((habit) => ({ habitId: habit.id, userId: habit.ownerId, date: '2026-08-27' }));
  const ranked = rankMembersByWeeklyScore(members, habits, checkIns, '2026-08-27');
  assert.deepEqual(ranked.map(({ id, rank, weeklyScore }) => ({ id, rank, weeklyScore })), [
    { id: 'b', rank: 1, weeklyScore: 100 },
    { id: 'c', rank: 2, weeklyScore: 100 },
    { id: 'a', rank: 3, weeklyScore: 100 },
  ]);
});
