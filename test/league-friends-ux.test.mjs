import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { weeklyLeaguePoints, rankMembersByWeeklyScore } from '../src/domain.js';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

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

test('League clearly displays its Monday through Sunday date range and point rules', () => {
  const league = app.slice(app.indexOf('function leagueScreen()'), app.indexOf('function challengeInfoSheet()'));
  const info = app.slice(app.indexOf('function challengeInfoSheet()'), app.indexOf('function stakeHistory()'));
  assert.match(league, /formatLeagueWeekRange/);
  assert.match(league, /weeklyPoints/);
  assert.match(league, /pts/);
  assert.match(info, /First 3 each day/);
  assert.match(info, /New habits unlock volume points after 2 separate days/);
});

test('proof, activity, grouped check-ins, comments, and proof viewer identities open profiles', () => {
  const activity = app.slice(app.indexOf('function activityCard('), app.indexOf('function personProofCarousel('));
  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress('));
  const comments = app.slice(app.indexOf('function commentSheet()'), app.indexOf('function batonSheet()'));
  const proofViewer = app.slice(app.indexOf('function proofViewerSheet()'), app.indexOf('function clearProofReview()'));
  assert.match(activity, /activityProfileButton/);
  assert.match(app, /function activityProfileButton[^]*data-friend-profile/);
  assert.match(friends, /activity\.items\.map[^]*data-friend-profile/);
  assert.match(comments, /data-friend-profile/);
  assert.match(proofViewer, /data-friend-profile/);
});

test('profile shows a collapsed friend count and expands the list on demand', () => {
  const profile = app.slice(app.indexOf('function friendProfileSheet()'), app.indexOf('function recoverySheet()'));
  assert.match(profile, /<details class="profile-connections"/);
  assert.match(profile, /<summary/);
  assert.match(profile, /connectionCount/);
  assert.match(profile, /\.length \+ 1/);
  assert.doesNotMatch(profile, /<section class="profile-connections"/);
});

test('Friends page owns Invite and Add by link while Settings no longer duplicates friend management', () => {
  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress('));
  const settings = app.slice(app.indexOf('function settingsSheet()'), app.indexOf('function nudgeComposerSheet()'));
  assert.match(friends, /data-invite-open/);
  assert.match(friends, /data-add-friend-open/);
  assert.match(app, /function addFriendSheet\(\)/);
  assert.doesNotMatch(settings, /data-settings-view="friends"/);
  assert.doesNotMatch(settings, /join-friend-form/);
});
