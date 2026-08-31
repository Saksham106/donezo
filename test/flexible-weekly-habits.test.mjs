import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weeklyCompletionScore,
  weeklyLeaguePoints,
} from '../src/domain.js';

const flexibleHabit = (overrides = {}) => ({
  id: 'gym',
  ownerId: 'me',
  title: 'Gym',
  emoji: '🏋️',
  active: true,
  frequency: 'times_per_week',
  scheduleFrequency: 'times_per_week',
  weeklyTargetDays: 4,
  targetQuantity: 1,
  targetUnit: 'count',
  createdDate: '2026-08-20',
  scheduleTimezone: 'UTC',
  pauseWindows: [],
  ...overrides,
});

const checkIn = (date, overrides = {}) => ({
  id: `ci-${date}-${Math.random()}`,
  habitId: 'gym',
  userId: 'me',
  date,
  completedQuantity: 1,
  invalid: false,
  ...overrides,
});

test('4-times-per-week progress uses four weekly slots instead of seven daily obligations', () => {
  const score = weeklyCompletionScore('me', [flexibleHabit()], [
    checkIn('2026-08-24'),
    checkIn('2026-08-26'),
  ], '2026-08-27');
  assert.deepEqual(score, { completed: 2, possible: 4, percent: 50 });
});

test('multiple check-ins on one calendar day earn only one flexible weekly day credit', () => {
  const score = weeklyCompletionScore('me', [flexibleHabit()], [
    checkIn('2026-08-24', { id: 'a' }),
    checkIn('2026-08-24', { id: 'b' }),
    checkIn('2026-08-26', { id: 'c' }),
  ], '2026-08-27');
  assert.deepEqual(score, { completed: 2, possible: 4, percent: 50 });
});

test('flexible goals require the per-day quantity before a day earns weekly credit', () => {
  const habit = flexibleHabit({ targetQuantity: 3, targetUnit: 'sets' });
  const score = weeklyCompletionScore('me', [habit], [
    checkIn('2026-08-24', { id: 'a', completedQuantity: 1 }),
    checkIn('2026-08-24', { id: 'b', completedQuantity: 2 }),
    checkIn('2026-08-25', { id: 'c', completedQuantity: 2 }),
  ], '2026-08-27');
  assert.deepEqual(score, { completed: 1, possible: 4, percent: 25 });
});

test('a newly created flexible habit has no partial creation-week obligation and starts next Monday', () => {
  const habit = flexibleHabit({ createdDate: '2026-08-27' });
  assert.deepEqual(weeklyCompletionScore('me', [habit], [checkIn('2026-08-28')], '2026-08-30'), {
    completed: 0,
    possible: 0,
    percent: 0,
  });
  assert.deepEqual(weeklyCompletionScore('me', [habit], [], '2026-08-31'), {
    completed: 0,
    possible: 4,
    percent: 0,
  });
});

test('extra completion days after the target do not create extra weekly credit or denominator', () => {
  const score = weeklyCompletionScore('me', [flexibleHabit()], [
    checkIn('2026-08-24'),
    checkIn('2026-08-25'),
    checkIn('2026-08-26'),
    checkIn('2026-08-27'),
    checkIn('2026-08-28'),
  ], '2026-08-30');
  assert.deepEqual(score, { completed: 4, possible: 4, percent: 100 });
});

test('pause windows cap a flexible target by eligible non-paused days', () => {
  const habit = flexibleHabit({
    createdDate: '2026-08-20',
    pauseWindows: [{ startDate: '2026-08-31', endDate: '2026-09-04' }],
  });
  const score = weeklyCompletionScore('me', [habit], [
    checkIn('2026-09-05'),
    checkIn('2026-09-06'),
  ], '2026-09-06');
  assert.deepEqual(score, { completed: 2, possible: 2, percent: 100 });
});

test('League progress uses the flexible target as possible commitments and actual chosen days for points', () => {
  const score = weeklyLeaguePoints('me', [flexibleHabit()], [
    checkIn('2026-08-24'),
    checkIn('2026-08-26'),
  ], '2026-08-27');
  assert.equal(score.completed, 2);
  assert.equal(score.possible, 4);
  assert.equal(score.percent, 50);
  assert.equal(score.completionPoints, 20);
});

test('a midweek schedule-version switch to flexible does not create a partial weekly target', () => {
  const habit = flexibleHabit({
    createdDate: '2026-08-24',
    scheduleVersions: [
      {
        version: 1,
        effectiveFrom: '2026-08-24',
        effectiveUntil: '2026-08-27',
        frequency: 'daily',
        weekdays: [],
        targetQuantity: 1,
        targetUnit: 'count',
        timezone: 'UTC',
      },
      {
        version: 2,
        effectiveFrom: '2026-08-27',
        effectiveUntil: null,
        frequency: 'times_per_week',
        weekdays: [],
        weeklyTargetDays: 4,
        targetQuantity: 1,
        targetUnit: 'count',
        timezone: 'UTC',
      },
    ],
  });
  assert.deepEqual(weeklyCompletionScore('me', [habit], [
    checkIn('2026-08-24'),
    checkIn('2026-08-25'),
  ], '2026-08-30'), {
    completed: 2,
    possible: 3,
    percent: 67,
  });
  assert.deepEqual(weeklyCompletionScore('me', [habit], [], '2026-08-31'), {
    completed: 0,
    possible: 4,
    percent: 0,
  });
});
