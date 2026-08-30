import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getScheduleOccurrence,
  listScheduleOccurrences,
  evaluateScheduleDate,
  resolveScheduleVersion,
  localDateTimeToUtc,
} from '../src/schedule.js';

const daily = (overrides = {}) => ({
  frequency: 'daily',
  targetQuantity: 1,
  targetUnit: 'glass',
  dueTime: '08:30',
  graceMinutes: 90,
  timezone: 'America/New_York',
  startDate: '2026-03-01',
  ...overrides,
});

test('daily schedules create a quantity target with due and grace instants in the schedule timezone', () => {
  const occurrence = getScheduleOccurrence(daily(), '2026-03-09');
  assert.equal(occurrence.scheduled, true);
  assert.equal(occurrence.targetQuantity, 1);
  assert.equal(occurrence.targetUnit, 'glass');
  assert.equal(occurrence.dueAt, '2026-03-09T12:30:00.000Z');
  assert.equal(occurrence.graceUntil, '2026-03-09T14:00:00.000Z');
});

test('selected weekdays are evaluated in local calendar space, not UTC day space', () => {
  const schedule = daily({ frequency: 'selected_weekdays', weekdays: [1, 3, 5] });
  assert.equal(getScheduleOccurrence(schedule, '2026-03-09').scheduled, true); // Monday
  assert.equal(getScheduleOccurrence(schedule, '2026-03-10').scheduled, false); // Tuesday
  assert.equal(getScheduleOccurrence(schedule, '2026-03-13').scheduled, true); // Friday
});

test('weekly schedules use a local-week anchor across timezone week boundaries', () => {
  const schedule = daily({
    frequency: 'weekly',
    weekdays: [0],
    startDate: '2026-08-02',
    timezone: 'Pacific/Kiritimati',
  });
  assert.equal(getScheduleOccurrence(schedule, '2026-08-02').scheduled, true);
  assert.equal(getScheduleOccurrence(schedule, '2026-08-09').scheduled, true);
  assert.equal(getScheduleOccurrence(schedule, '2026-08-08').scheduled, false);
  assert.equal(getScheduleOccurrence(schedule, '2026-08-09').weekKey, '2026-W32');
});

test('pause windows suppress occurrences inclusively without changing history', () => {
  const schedule = daily({ pauseWindows: [{ startDate: '2026-03-10', endDate: '2026-03-12' }] });
  assert.equal(getScheduleOccurrence(schedule, '2026-03-09').scheduled, true);
  assert.equal(getScheduleOccurrence(schedule, '2026-03-10').scheduled, false);
  assert.equal(getScheduleOccurrence(schedule, '2026-03-12').paused, true);
  assert.equal(getScheduleOccurrence(schedule, '2026-03-13').scheduled, true);
});

test('local date ranges include DST transition days exactly once', () => {
  const schedule = daily({ dueTime: '02:30', graceMinutes: 0 });
  const occurrences = listScheduleOccurrences(schedule, '2026-03-07', '2026-03-10');
  assert.deepEqual(occurrences.map(({ date }) => date), ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  assert.equal(occurrences[1].date, '2026-03-08');
  assert.match(occurrences[1].dueAt, /^2026-03-08T/);
});

test('weekly progression is based on local dates even when UTC is already in another week', () => {
  const schedule = daily({ frequency: 'weekly', weekdays: [1], startDate: '2026-08-03', timezone: 'America/Los_Angeles' });
  const occurrence = getScheduleOccurrence(schedule, '2026-08-10');
  assert.equal(occurrence.scheduled, true);
  assert.equal(occurrence.weekKey, '2026-W33');
});

test('evaluation aggregates quantity completions and reports due/grace status', () => {
  const occurrence = getScheduleOccurrence(daily({ targetQuantity: 3, targetUnit: 'minutes', dueTime: '10:00', graceMinutes: 30 }), '2026-03-09');
  assert.deepEqual(evaluateScheduleDate(daily({ targetQuantity: 3, targetUnit: 'minutes', dueTime: '10:00', graceMinutes: 30 }), '2026-03-09', {
    completedQuantity: 2,
    now: '2026-03-09T14:15:00.000Z',
  }), {
    ...occurrence,
    completedQuantity: 2,
    remainingQuantity: 1,
    achieved: false,
    status: 'grace',
  });
});

test('historical schedule versions are selected by local effective dates', () => {
  const versions = [
    { version: 1, effectiveFrom: '2026-01-01', effectiveUntil: '2026-03-10', frequency: 'daily', targetQuantity: 1 },
    { version: 2, effectiveFrom: '2026-03-10', effectiveUntil: null, frequency: 'selected_weekdays', weekdays: [1], targetQuantity: 2 },
  ];
  assert.equal(resolveScheduleVersion(versions, '2026-03-09').version, 1);
  assert.equal(resolveScheduleVersion(versions, '2026-03-10').version, 2);
  assert.equal(getScheduleOccurrence({ versions }, '2026-03-10').targetQuantity, 2);
});

test('local date-time conversion keeps due time stable over both DST offsets', () => {
  assert.equal(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York'), '2026-11-01T05:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-11-02', '01:30', 'America/New_York'), '2026-11-02T06:30:00.000Z');
});
