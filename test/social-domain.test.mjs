import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weeklyChallengeProgress,
  missedHabitRecoveryState,
  createRecoveryEvent,
  applyRecovery,
  calculateBounceBackMetrics,
  buildWeeklySquadRecap,
  buildPrivacySafeExportPayload,
} from '../src/social-domain.js';

const week = { weekStart: '2026-08-24', weekEnd: '2026-08-30' };

function habit(id, ownerId, createdDate = week.weekStart) {
  return { id, ownerId, frequency: 'daily', active: true, createdDate };
}

function checkIn(habitId, userId, date, extra = {}) {
  return { id: `${habitId}-${date}`, habitId, userId, date, ...extra };
}

test('weekly challenge completion percentage counts valid unique commitments through a partial week', () => {
  const result = weeklyChallengeProgress(
    { id: 'challenge-1', type: 'completion_percentage', target: 75, ...week },
    {
      members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      habits: [habit('a-run', 'a'), habit('b-read', 'b', '2026-08-25')],
      checkIns: [
        checkIn('a-run', 'a', '2026-08-24'),
        checkIn('a-run', 'a', '2026-08-25'),
        checkIn('a-run', 'a', '2026-08-25'),
        checkIn('b-read', 'b', '2026-08-25'),
        checkIn('b-read', 'b', '2026-08-26', { invalid: true }),
        checkIn('b-read', 'b', '2026-08-26'),
      ],
      asOfDate: '2026-08-26',
    },
  );

  assert.deepEqual(result.period, { start: '2026-08-24', end: '2026-08-26' });
  assert.deepEqual(result.progress, {
    completed: 4,
    total: 5,
    target: 75,
    ratio: 0.8,
    percent: 80,
    achieved: true,
  });
  assert.equal(result.status, 'in_progress');
  assert.deepEqual(result.participants.map(({ id, completed, total, percent }) => ({ id, completed, total, percent })), [
    { id: 'a', completed: 2, total: 3, percent: 67 },
    { id: 'b', completed: 2, total: 2, percent: 100 },
  ]);
});

test('weekly total-completions challenge deduplicates check-ins and exposes participant winners', () => {
  const result = weeklyChallengeProgress(
    { id: 'challenge-2', metric: 'total_completions', target: 4, ...week },
    {
      members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      habits: [habit('a-run', 'a'), habit('b-read', 'b')],
      checkIns: [
        checkIn('a-run', 'a', '2026-08-24'),
        checkIn('a-run', 'a', '2026-08-24'),
        checkIn('b-read', 'b', '2026-08-25'),
        checkIn('b-read', 'b', '2026-08-26'),
        checkIn('other', 'b', '2026-08-26'),
      ],
      asOfDate: '2026-08-26',
    },
  );

  assert.equal(result.progress.completed, 3);
  assert.equal(result.progress.total, 4);
  assert.equal(result.progress.percent, 75);
  assert.equal(result.progress.achieved, false);
  assert.deepEqual(result.winnerIds, ['b']);
});

test('no-consecutive-miss challenge reports each violating habit and treats one-day activity as compliant', () => {
  const result = weeklyChallengeProgress(
    { id: 'challenge-3', type: 'no-consecutive-miss', ...week },
    {
      members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      habits: [habit('a-run', 'a'), habit('b-read', 'b')],
      checkIns: [
        checkIn('a-run', 'a', '2026-08-24'),
        checkIn('a-run', 'a', '2026-08-27'),
        checkIn('b-read', 'b', '2026-08-24'),
        checkIn('b-read', 'b', '2026-08-26'),
      ],
      asOfDate: '2026-08-27',
    },
  );

  assert.equal(result.progress.achieved, false);
  assert.equal(result.progress.percent, 50);
  assert.deepEqual(result.violations, [{ memberId: 'a', habitId: 'a-run', dates: ['2026-08-25', '2026-08-26'] }]);
  assert.deepEqual(result.participants.map(({ id, consecutiveMisses }) => ({ id, consecutiveMisses })), [
    { id: 'a', consecutiveMisses: 1 },
    { id: 'b', consecutiveMisses: 0 },
  ]);
});

test('weekly challenge derives a Monday UTC period and does not count archived or non-daily habits', () => {
  const result = weeklyChallengeProgress(
    { type: 'total_completions', target: 2 },
    {
      members: [{ id: 'a', name: 'A' }],
      habits: [
        habit('daily', 'a', '2026-08-24'),
        { ...habit('archived', 'a'), active: false, archivedDate: '2026-08-23' },
        { ...habit('weekly', 'a'), frequency: 'weekly' },
      ],
      checkIns: [checkIn('daily', 'a', '2026-08-24'), checkIn('archived', 'a', '2026-08-25')],
      asOfDate: '2026-08-26',
    },
  );

  assert.deepEqual(result.period, { start: '2026-08-24', end: '2026-08-26' });
  assert.equal(result.progress.completed, 1);
});

test('missed habit state keeps a miss distinct from a later recovery', () => {
  const habitData = habit('run', 'a');
  assert.deepEqual(missedHabitRecoveryState({
    habit: habitData,
    checkIns: [],
    recoveryEvents: [],
    date: '2026-08-24',
    asOfDate: '2026-08-25',
  }), {
    habitId: 'run',
    userId: 'a',
    date: '2026-08-24',
    status: 'missed',
    originalStatus: 'missed',
    canRecover: true,
    recoveryAction: 'recover_today',
    recovery: null,
  });

  const recovery = createRecoveryEvent({ habitId: 'run', userId: 'a', missedDate: '2026-08-24', recoveredDate: '2026-08-25', action: 'recover_today' });
  const recovered = missedHabitRecoveryState({
    habit: habitData,
    checkIns: [checkIn('run', 'a', '2026-08-25')],
    recoveryEvents: [recovery],
    date: '2026-08-24',
    asOfDate: '2026-08-25',
  });
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.originalStatus, 'missed');
  assert.equal(recovered.recovery.recoveredDate, '2026-08-25');
  assert.equal(recovery.visibility, 'private');
});

test('recovery actions are append-only and never rewrite the original missed date', () => {
  const misses = [{ habitId: 'run', userId: 'a', date: '2026-08-24', status: 'missed' }];
  const recovery = createRecoveryEvent({ habitId: 'run', userId: 'a', missedDate: '2026-08-24', recoveredDate: '2026-08-25', action: 'adjust_habit', reason: 'Too ambitious' });
  const state = applyRecovery({ misses, recoveries: [] }, recovery);

  assert.deepEqual(state.misses, misses);
  assert.deepEqual(state.recoveries, [recovery]);
  assert.equal(state.misses[0].date, '2026-08-24');
  assert.throws(() => createRecoveryEvent({ habitId: 'run', userId: 'a', missedDate: '2026-08-25', recoveredDate: '2026-08-24' }), /after/i);
});

test('bounce-back metrics calculate speed, recovery rate, and consecutive recovery days', () => {
  const metrics = calculateBounceBackMetrics({
    misses: [
      { habitId: 'run', userId: 'a', date: '2026-08-24' },
      { habitId: 'run', userId: 'a', date: '2026-08-27' },
      { habitId: 'read', userId: 'b', date: '2026-08-26' },
    ],
    recoveries: [createRecoveryEvent({ habitId: 'run', userId: 'a', missedDate: '2026-08-24', recoveredDate: '2026-08-26' })],
    checkIns: [
      checkIn('run', 'a', '2026-08-26'),
      checkIn('run', 'a', '2026-08-27'),
      checkIn('run', 'a', '2026-08-28'),
    ],
    asOfDate: '2026-08-28',
  });

  assert.equal(metrics.missedCount, 3);
  assert.equal(metrics.recoveredCount, 2);
  assert.equal(metrics.unrecoveredCount, 1);
  assert.equal(metrics.averageBounceBackDays, 1.5);
  assert.equal(metrics.fastestBounceBackDays, 1);
  assert.equal(metrics.recoveryRate, 67);
  assert.equal(metrics.currentRecoveryStreak, 3);
  assert.deepEqual(metrics.bounces.map(({ habitId, bounceBackDays }) => ({ habitId, bounceBackDays })), [
    { habitId: 'run', bounceBackDays: 2 },
    { habitId: 'run', bounceBackDays: 1 },
    { habitId: 'read', bounceBackDays: null },
  ]);
});

const recapHabits = [habit('a-habit', 'a', '2026-08-17'), habit('b-habit', 'b', '2026-08-17'), habit('c-habit', 'c', '2026-08-17')];
const recapMembers = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cara' }];
const recapCheckIns = [
  ...['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'].map((date) => checkIn('a-habit', 'a', date)),
  ...['2026-08-24', '2026-08-26', '2026-08-28'].map((date) => checkIn('b-habit', 'b', date)),
  ...['2026-08-24', '2026-08-26', '2026-08-28'].map((date) => checkIn('c-habit', 'c', date)),
  ...['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].map((date) => checkIn('a-habit', 'a', date)),
  checkIn('b-habit', 'b', '2026-08-17'),
  ...['2026-08-17', '2026-08-18', '2026-08-19'].map((date) => checkIn('c-habit', 'c', date)),
];

test('weekly squad recap compares weeks and returns deterministic awards and member metrics', () => {
  const recap = buildWeeklySquadRecap({
    members: recapMembers,
    habits: recapHabits,
    checkIns: recapCheckIns,
    misses: [{ habitId: 'b-habit', userId: 'b', date: '2026-08-25' }],
    recoveries: [createRecoveryEvent({ habitId: 'b-habit', userId: 'b', missedDate: '2026-08-25', recoveredDate: '2026-08-26' })],
    nudges: [
      { fromUserId: 'b', toUserId: 'a', message: 'You have got this', visibility: 'private' },
      { fromUserId: 'b', toUserId: 'c', message: 'Keep going', visibility: 'squad' },
      { fromUserId: 'a', toUserId: 'b', message: 'Nice work', visibility: 'squad' },
    ],
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
    previousWeekStart: '2026-08-17',
    previousWeekEnd: '2026-08-23',
    asOfDate: '2026-08-30',
  });

  assert.deepEqual(recap.summary, {
    completionPercent: 52,
    previousCompletionPercent: 38,
    changePoints: 14,
    participantCount: 3,
    activeParticipantCount: 3,
  });
  assert.deepEqual(recap.awards.bestStreak, { value: 5, memberIds: ['a'] });
  assert.deepEqual(recap.awards.biggestImprovement, { value: 29, memberIds: ['b'] });
  assert.deepEqual(recap.awards.fastestRecovery, { value: 1, memberIds: ['b'] });
  assert.deepEqual(recap.awards.mostSupportive, { value: 2, memberIds: ['b'] });
});

test('recap handles ties, no activity, small groups, and partial weeks without NaN', () => {
  const tie = buildWeeklySquadRecap({
    members: [{ id: 'z', name: 'Zed' }, { id: 'a', name: 'Ada' }],
    habits: [habit('z-habit', 'z'), habit('a-habit', 'a')],
    checkIns: [checkIn('z-habit', 'z', '2026-08-24'), checkIn('a-habit', 'a', '2026-08-24')],
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
    asOfDate: '2026-08-24',
  });
  assert.deepEqual(tie.awards.bestStreak.memberIds, ['a', 'z']);
  assert.deepEqual(tie.awards.biggestImprovement.memberIds, ['a', 'z']);
  assert.equal(tie.summary.completionPercent, 100);

  const empty = buildWeeklySquadRecap({
    members: [{ id: 'solo', name: 'Solo' }], habits: [habit('solo-habit', 'solo')], checkIns: [],
    weekStart: '2026-08-24', weekEnd: '2026-08-30', asOfDate: '2026-08-26',
  });
  assert.deepEqual(empty.summary, { completionPercent: 0, previousCompletionPercent: 0, changePoints: 0, participantCount: 1, activeParticipantCount: 0 });
  assert.deepEqual(empty.awards.bestStreak, { value: 0, memberIds: [] });
  assert.equal(Number.isNaN(empty.summary.completionPercent), false);
});

test('privacy-safe export excludes private text, proof images, and opted-out awards by default', () => {
  const recap = buildWeeklySquadRecap({
    members: recapMembers.map((member) => ({ ...member, awardOptOut: member.id === 'b' })),
    habits: recapHabits,
    checkIns: recapCheckIns,
    nudges: [{ fromUserId: 'b', toUserId: 'a', message: 'private note', visibility: 'private' }],
    weekStart: '2026-08-24', weekEnd: '2026-08-30', asOfDate: '2026-08-30',
  });
  const payload = buildPrivacySafeExportPayload(recap, {
    optOutMemberIds: ['b'],
    privateTexts: ['private note'],
    proofImages: ['https://example.test/proof.jpg'],
  });

  assert.equal(payload.privateTexts, undefined);
  assert.equal(payload.proofImages, undefined);
  assert.equal(payload.awards.biggestImprovement.memberIds.includes('b'), false);
  assert.equal(JSON.stringify(payload).includes('private note'), false);
  assert.equal(JSON.stringify(payload).includes('proof.jpg'), false);
});

test('privacy export includes sensitive fields only after explicit confirmation and request', () => {
  const recap = buildWeeklySquadRecap({ members: [], habits: [], checkIns: [], weekStart: '2026-08-24', weekEnd: '2026-08-30', asOfDate: '2026-08-30' });
  const payload = buildPrivacySafeExportPayload(recap, {
    confirmed: true,
    includePrivateTexts: true,
    includeProofImages: true,
    privateTexts: ['shared note'],
    proofImages: ['proof-token'],
  });
  assert.deepEqual(payload.privateTexts, ['shared note']);
  assert.deepEqual(payload.proofImages, ['proof-token']);
});

test('privacy export always honors recap opt-outs even when caller omits its option', () => {
  const recap = {
    period: { start: '2026-08-24', end: '2026-08-30' },
    previousPeriod: { start: '2026-08-17', end: '2026-08-23' },
    summary: {}, memberStats: [], nextGoal: null, optOutMemberIds: ['private-user'],
    awards: { bestStreak: { value: 4, memberIds: ['private-user'] } },
  };
  const payload = buildPrivacySafeExportPayload(recap, { optOutMemberIds: [] });
  assert.deepEqual(payload.awards.bestStreak.memberIds, []);
});

test('privacy export only carries allow-listed public next-goal fields', () => {
  const recap = {
    period: { start: '2026-08-24', end: '2026-08-30' }, previousPeriod: { start: '2026-08-17', end: '2026-08-23' },
    summary: {}, memberStats: [], awards: {}, nextGoal: { title: 'Next week', target: 5, privateText: 'do not export' },
  };
  const payload = buildPrivacySafeExportPayload(recap);
  assert.deepEqual(payload.nextGoal, { title: 'Next week', target: 5 });
  assert.equal(JSON.stringify(payload).includes('do not export'), false);
});

test('weekly supportive award only counts support activity inside the recap period', () => {
  const recap = buildWeeklySquadRecap({
    members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    habits: [habit('a-habit', 'a', '2026-08-17'), habit('b-habit', 'b', '2026-08-17')],
    checkIns: [],
    nudges: [
      { fromUserId: 'a', toUserId: 'b', message: 'old', createdAt: '2026-08-23T12:00:00Z' },
      { fromUserId: 'b', toUserId: 'a', message: 'this week', createdAt: '2026-08-24T12:00:00Z' },
    ],
    weekStart: '2026-08-24', weekEnd: '2026-08-30', asOfDate: '2026-08-30',
  });
  assert.deepEqual(recap.awards.mostSupportive, { value: 1, memberIds: ['b'] });
});
