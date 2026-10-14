import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionableHabitsFor,
  completedHabitsFor,
  dayStatus,
  feedActivities,
  flexibleWeekProgress,
  friendRequestSummary,
  groupByInitial,
  habitIsDue,
  habitPausedOn,
  historyEntries,
  isComeback,
  isCheckedIn,
  missedHabits,
  shiftDate,
  sortHabitsForDay,
  unseenUpdatesCount,
  updatesList,
  weekBounds,
  weekStrip,
} from '../src/today-domain.js';

// 2026-10-05 is a Monday.
const MONDAY = '2026-10-05';
const daily = { id: 'daily', ownerId: 'me', active: true, title: 'Run', emoji: '🏃', scheduleFrequency: 'daily', createdDate: '2026-09-01', targetTime: '18:00' };
const monWed = { id: 'monwed', ownerId: 'me', active: true, title: 'Gym', emoji: '🏋️', scheduleFrequency: 'selected_weekdays', scheduleWeekdays: [1, 3], createdDate: '2026-09-01', targetTime: '07:00' };
const flexible = { id: 'flex', ownerId: 'me', active: true, title: 'Read', emoji: '📚', scheduleFrequency: 'times_per_week', weeklyTargetDays: 2, createdDate: '2026-09-01' };
const friendHabit = { id: 'friend-habit', ownerId: 'friend', active: true, title: 'Walk', scheduleFrequency: 'daily', createdDate: '2026-09-01' };

function stateWith(overrides = {}) {
  return { currentUserId: 'me', habits: [daily, monWed, flexible, friendHabit], checkIns: [], recoveries: [], ...overrides };
}

const checkIn = (habitId, date, extra = {}) => ({ id: `${habitId}:${date}`, habitId, userId: 'me', date, completedAt: `${date}T10:00:00Z`, ...extra });

test('shiftDate and weekBounds use Monday–Sunday weeks', () => {
  assert.equal(shiftDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(weekBounds(MONDAY), { start: MONDAY, end: '2026-10-11' });
  assert.deepEqual(weekBounds('2026-10-11'), { start: MONDAY, end: '2026-10-11' });
  assert.deepEqual(weekBounds('2026-10-04'), { start: '2026-09-28', end: '2026-10-04' });
});

test('habitIsDue follows the schedule; flexible habits are never "due" on a specific day', () => {
  assert.equal(habitIsDue(daily, '2026-10-04'), true);
  assert.equal(habitIsDue(monWed, MONDAY), true);
  assert.equal(habitIsDue(monWed, '2026-10-06'), false);
  assert.equal(habitIsDue(flexible, MONDAY), false);
});

test('habitPausedOn is inclusive on both ends', () => {
  const paused = { ...daily, pauseWindows: [{ startDate: '2026-10-05', endDate: '2026-10-07' }] };
  assert.equal(habitPausedOn(paused, '2026-10-04'), false);
  assert.equal(habitPausedOn(paused, '2026-10-05'), true);
  assert.equal(habitPausedOn(paused, '2026-10-07'), true);
  assert.equal(habitPausedOn(paused, '2026-10-08'), false);
});

test('rejected check-ins do not count as checked in', () => {
  const state = stateWith({ checkIns: [checkIn('daily', MONDAY, { invalid: true })] });
  assert.equal(isCheckedIn(state, 'daily', 'me', MONDAY), false);
});

test('actionableHabitsFor drives the Check In button (0 / 1 / 2+ due)', () => {
  const none = stateWith({ habits: [friendHabit] });
  assert.deepEqual(actionableHabitsFor('me', MONDAY, none), []);

  const one = stateWith({ habits: [monWed, friendHabit] });
  assert.deepEqual(actionableHabitsFor('me', MONDAY, one).map((habit) => habit.id), ['monwed']);

  const many = stateWith();
  assert.deepEqual(actionableHabitsFor('me', MONDAY, many).map((habit) => habit.id), ['daily', 'monwed', 'flex']);

  const someDone = stateWith({ checkIns: [checkIn('daily', MONDAY), checkIn('flex', MONDAY)] });
  assert.deepEqual(actionableHabitsFor('me', MONDAY, someDone).map((habit) => habit.id), ['monwed']);
  assert.deepEqual(completedHabitsFor('me', MONDAY, someDone).map((habit) => habit.id).sort(), ['daily', 'flex']);
});

test('flexible habits leave the work list once the weekly target is met', () => {
  const state = stateWith({ checkIns: [checkIn('flex', MONDAY), checkIn('flex', '2026-10-06')] });
  const progress = flexibleWeekProgress(flexible, '2026-10-07', state);
  assert.equal(progress.target, 2);
  assert.equal(progress.completed, 2);
  assert.equal(progress.complete, true);
  assert.equal(actionableHabitsFor('me', '2026-10-07', state).some((habit) => habit.id === 'flex'), false);
  assert.equal(flexibleWeekProgress(daily, MONDAY, state), null);
});

test('sortHabitsForDay puts open habits first, then by time, then title', () => {
  const state = stateWith({ checkIns: [checkIn('monwed', MONDAY)] });
  const sorted = sortHabitsForDay([monWed, daily, flexible], state, 'me', MONDAY).map((habit) => habit.id);
  assert.deepEqual(sorted, ['daily', 'flex', 'monwed']);
});

test('missedHabits lists yesterday’s unrecovered misses only', () => {
  const tuesday = '2026-10-06';
  assert.deepEqual(missedHabits(stateWith(), tuesday).map((habit) => [habit.id, habit.missedDate]), [['daily', MONDAY], ['monwed', MONDAY]]);
  const recovered = stateWith({ checkIns: [checkIn('daily', MONDAY)], recoveries: [{ habitId: 'monwed', missedDate: MONDAY }] });
  assert.deepEqual(missedHabits(recovered, tuesday), []);
  const brandNew = stateWith({ habits: [{ ...daily, createdDate: tuesday }] });
  assert.deepEqual(missedHabits(brandNew, tuesday), []);
});

test('dayStatus and weekStrip cover every state', () => {
  const thursday = '2026-10-08';
  const state = stateWith({
    habits: [daily],
    checkIns: [checkIn('daily', MONDAY), checkIn('daily', thursday)],
    recoveries: [{ habitId: 'daily', missedDate: '2026-10-06' }],
  });
  assert.equal(dayStatus(state, 'me', MONDAY, thursday), 'completed');
  assert.equal(dayStatus(state, 'me', '2026-10-06', thursday), 'recovered');
  assert.equal(dayStatus(state, 'me', '2026-10-07', thursday), 'missed');
  assert.equal(dayStatus(state, 'me', thursday, thursday), 'completed');
  assert.equal(dayStatus(state, 'me', '2026-10-09', thursday), 'upcoming');
  assert.equal(dayStatus(stateWith({ habits: [] }), 'me', MONDAY, thursday), 'none');
  assert.equal(dayStatus(stateWith({ habits: [daily] }), 'me', thursday, thursday), 'today');

  const strip = weekStrip(state, 'me', thursday);
  assert.deepEqual(strip.map((day) => day.label), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(strip.map((day) => day.day), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(strip.map((day) => day.status), ['completed', 'recovered', 'missed', 'completed', 'upcoming', 'upcoming', 'upcoming']);
});

test('historyEntries is newest first, filtered by user and range', () => {
  const state = stateWith({ checkIns: [
    checkIn('daily', '2026-10-01'),
    checkIn('daily', MONDAY),
    checkIn('monwed', MONDAY, { completedAt: `${MONDAY}T07:00:00Z` }),
    { ...checkIn('friend-habit', MONDAY), userId: 'friend' },
  ] });
  assert.deepEqual(historyEntries(state, 'me').map((item) => item.id), [`daily:${MONDAY}`, `monwed:${MONDAY}`, 'daily:2026-10-01']);
  assert.deepEqual(historyEntries(state, 'me', { from: MONDAY, to: MONDAY }).length, 2);
});

test('groupByInitial sorts A–Z case-insensitively with "#" last', () => {
  const groups = groupByInitial([{ name: 'bea' }, { name: 'Alex' }, { name: '9lives' }, { name: 'Ann' }, { name: '' }]);
  assert.deepEqual(groups.map((group) => group.letter), ['A', 'B', '#']);
  assert.deepEqual(groups[0].people.map((person) => person.name), ['Alex', 'Ann']);
  assert.equal(groups[2].people.length, 2);
});

test('friendRequestSummary splits pending requests by direction', () => {
  const summary = friendRequestSummary({
    currentUserId: 'me',
    friendRequests: [
      { id: 'a', status: 'pending', requesterId: 'x', addresseeId: 'me' },
      { id: 'b', status: 'pending', requesterId: 'me', addresseeId: 'y' },
      { id: 'c', status: 'accepted', requesterId: 'z', addresseeId: 'me' },
    ],
  });
  assert.deepEqual(summary.incoming.map((item) => item.id), ['a']);
  assert.deepEqual(summary.outgoing.map((item) => item.id), ['b']);
});

test('feed hides missed and call-out events; comebacks are tagged', () => {
  const activities = [{ id: 1, type: 'completed' }, { id: 2, type: 'missed' }, { id: 3, type: 'callout' }, { id: 4, type: 'recovery' }, { id: 5, type: 'recovered' }];
  assert.deepEqual(feedActivities(activities).map((item) => item.id), [1, 4, 5]);
  assert.equal(isComeback(activities[3]), true);
  assert.equal(isComeback(activities[4]), true);
  assert.equal(isComeback(activities[0]), false);
});

test('updates merge nudges, non-photo activity and notifications, newest first', () => {
  const state = {
    currentUserId: 'me',
    updatesLastSeenAt: '2026-10-05T09:00:00Z',
    nudges: [
      { id: 'n1', toUserId: 'me', fromUserId: 'f', createdAt: '2026-10-05T10:00:00Z', message: 'go', readAt: null },
      { id: 'n2', toUserId: 'f', fromUserId: 'me', createdAt: '2026-10-05T11:00:00Z', message: 'not mine' },
    ],
    notificationEvents: [
      { id: 'e1', category: 'reaction', createdAt: '2026-10-05T12:00:00Z', title: 'Hype' },
      { id: 'e2', category: 'nudge', createdAt: '2026-10-05T12:00:00Z' },
      { id: 'e3', category: 'friend_activity', createdAt: '2026-10-05T08:00:00Z', metadata: { checkInId: 'c-native' } },
    ],
  };
  const activities = [
    { id: 'a1', userId: 'f', when: '2026-10-05T09:30:00Z', checkInId: 'c-native', habitTitle: 'Walk' },
    { id: 'a2', userId: 'f', when: '2026-10-05T09:45:00Z', proofPath: 'p.jpg' },
  ];
  const list = updatesList(state, activities);
  assert.deepEqual(list.map((item) => item.id), ['notification:e1', 'nudge:n1', 'activity:a1']);
  assert.equal(unseenUpdatesCount(state, activities), 3);
});
