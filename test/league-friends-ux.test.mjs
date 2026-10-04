import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { leagueTimeLeft, weeklyLeaguePoints, rankMembersByWeeklyScore } from '../src/domain.js';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;

const matureHabit = (id, ownerId, createdDate = '2026-08-24') => ({
  id,
  ownerId,
  active: true,
  frequency: 'daily',
  createdDate,
});

const check = (habitId, userId, date) => ({ habitId, userId, date });

test('League points reward more completed commitments with diminishing daily returns', () => {
  const habits = [
    matureHabit('a1', 'a'),
    ...Array.from({ length: 8 }, (_, index) => matureHabit(`b${index + 1}`, 'b')),
  ];
  const checkIns = [
    check('a1', 'a', '2026-08-31'),
    ...Array.from({ length: 8 }, (_, index) => check(`b${index + 1}`, 'b', '2026-08-31')),
  ];

  assert.deepEqual(weeklyLeaguePoints('a', habits, checkIns, '2026-08-31'), {
    points: 15,
    completionPoints: 10,
    cleanDayBonus: 5,
    completed: 1,
    possible: 1,
    percent: 100,
  });
  assert.deepEqual(weeklyLeaguePoints('b', habits, checkIns, '2026-08-31'), {
    points: 42,
    completionPoints: 37,
    cleanDayBonus: 5,
    completed: 8,
    possible: 8,
    percent: 100,
  });
});

test('new habits need two real days before they earn volume points', () => {
  const habits = [matureHabit('new', 'a', '2026-08-31')];
  const unproven = weeklyLeaguePoints('a', habits, [check('new', 'a', '2026-08-31')], '2026-08-31');
  assert.equal(unproven.completionPoints, 0);
  assert.equal(unproven.cleanDayBonus, 0);
  assert.equal(unproven.points, 0);
  const proven = weeklyLeaguePoints('a', habits, [
    check('new', 'a', '2026-08-31'),
    check('new', 'a', '2026-09-01'),
  ], '2026-09-01');
  assert.equal(proven.completionPoints, 20);
  assert.equal(proven.points, 30);
});

test('League ranking uses anti-gaming points, then adherence and streak', () => {
  const members = [
    { id: 'a', name: 'A', currentStreak: 2 },
    { id: 'b', name: 'B', currentStreak: 2 },
  ];
  const habits = [matureHabit('a1', 'a'), matureHabit('b1', 'b'), matureHabit('b2', 'b')];
  const checkIns = [check('a1', 'a', '2026-08-31'), check('b1', 'b', '2026-08-31'), check('b2', 'b', '2026-08-31')];
  const ranked = rankMembersByWeeklyScore(members, habits, checkIns, '2026-08-31');
  assert.deepEqual(ranked.map((member) => [member.id, member.weeklyPoints]), [['b', 25], ['a', 15]]);
});

test('League countdown is concise across the Monday-Sunday period', () => {
  assert.equal(leagueTimeLeft('2026-09-06', '2026-08-31'), '6 days left');
  assert.equal(leagueTimeLeft('2026-09-06', '2026-09-05'), '1 day left');
  assert.equal(leagueTimeLeft('2026-09-06', '2026-09-06'), 'Ends today');
});
