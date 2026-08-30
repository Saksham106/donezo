import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/store.js';
import { validateCommentBody } from '../src/social-domain.js';
import { BADGE_CATALOG, computeEarnedBadges } from '../src/badges-domain.js';
import { buildMonthlyWrapped } from '../src/wrapped-domain.js';

const members = [
  { id: 'me', name: 'Me', timeZone: 'America/New_York', awardOptOut: false },
  { id: 'friend', name: 'Friend', timeZone: 'America/New_York', awardOptOut: false },
];
const habits = [
  { id: 'run', ownerId: 'me', circleId: 'circle-1', frequency: 'daily', active: true, createdDate: '2026-07-01', xp: 10 },
  { id: 'read', ownerId: 'friend', circleId: 'circle-1', frequency: 'daily', active: true, createdDate: '2026-07-01', xp: 10 },
];
const checkIns = [
  { id: 'c1', habitId: 'run', userId: 'me', date: '2026-08-24', proofPath: 'me/run-1.jpg' },
  { id: 'c2', habitId: 'run', userId: 'me', date: '2026-08-25' },
  { id: 'c3', habitId: 'read', userId: 'friend', date: '2026-08-24' },
  { id: 'bad', habitId: 'run', userId: 'me', date: '2026-08-26', invalid: true },
];

test('comment validation is flat, short, and rejects tampering-shaped input', () => {
  assert.equal(validateCommentBody('  nice work  '), 'nice work');
  assert.throws(() => validateCommentBody(''), /1–180/);
  assert.throws(() => validateCommentBody('x'.repeat(181)), /1–180/);
  assert.throws(() => validateCommentBody({ text: 'not a string' }), /1–180/);
});

test('earned badges are deterministic lifetime facts and ignore invalid completions', () => {
  const earned = computeEarnedBadges({
    userId: 'me', members, habits,
    checkIns: [...checkIns, ...Array.from({ length: 25 }, (_, i) => ({ id: `more-${i}`, habitId: 'run', userId: 'me', date: `2026-07-${String((i % 25) + 1).padStart(2, '0')}` }))],
    batonHandoffs: Array.from({ length: 10 }, (_, i) => ({ id: `handoff-${i}`, fromUserId: 'me', toUserId: 'friend', circleId: 'circle-1' })),
    asOfDate: '2026-08-31', timeZone: 'America/New_York',
  });
  assert.equal(earned.some((badge) => badge.id === 'completions_25'), true);
  assert.equal(earned.some((badge) => badge.id === 'streak_365'), false);
  assert.equal(earned.some((badge) => badge.id === 'baton_10'), true);
  assert.equal(new Set(earned.map((badge) => badge.id)).size, earned.length);
  assert.equal(BADGE_CATALOG.every((badge) => badge.id && badge.name && badge.description), true);
});

test('monthly Wrapped returns at most five screens, deterministic tied awards, and respects opt-out', () => {
  const wrapped = buildMonthlyWrapped({
    month: '2026-08', circleId: 'circle-1', members,
    habits, checkIns: [...checkIns, { id: 'c4', habitId: 'run', userId: 'me', date: '2026-08-30' }],
    reactions: [{ id: 'r1', checkInId: 'c1', userId: 'friend', emoji: '🔥', createdAt: '2026-08-24T10:00:00Z' }],
    comments: [{ id: 'comment', checkInId: 'c1', authorId: 'friend', body: 'go', createdAt: '2026-08-24T10:00:00Z' }],
    batonHandoffs: [], asOfDate: '2026-08-31', timeZone: 'America/New_York',
  });
  assert.equal(wrapped.period.month, '2026-08');
  assert.equal(wrapped.screens.length <= 5, true);
  assert.equal(wrapped.awards.length <= 5, true);
  assert.equal(wrapped.awards.some((award) => award.type === 'most_completed'), true);
  assert.equal(wrapped.awards.every((award) => !award.memberIds.includes('friend') || !members[1].awardOptOut), true);

  const optedOut = buildMonthlyWrapped({
    month: '2026-08', circleId: 'circle-1', members: members.map((member) => ({ ...member, awardOptOut: member.id === 'me' })), habits, checkIns, asOfDate: '2026-08-31', timeZone: 'America/New_York',
  });
  assert.equal(optedOut.awards.some((award) => award.memberIds.includes('me')), false);
});

test('memory repository provides exact-circle comments and race-safe baton semantics', () => {
  const repo = createMemoryRepository({
    currentUserId: 'me', circleId: 'circle-1', members, habits,
    checkIns: [{ id: 'check', habitId: 'run', userId: 'me', date: '2026-08-31', invalid: false }],
    comments: [], baton: { id: 'baton', circleId: 'circle-1', holderUserId: 'me', active: true, expiresAt: '2026-09-01T00:00:00Z' }, batonHandoffs: [], nudges: [],
  });
  assert.throws(() => repo.addComment('check', 'x'.repeat(181)), /1–180/);
  const comment = repo.addComment('check', 'ship it');
  assert.equal(comment.authorId, 'me');
  assert.throws(() => repo.deleteComment(comment.id.replace('comment', 'other')), /own comment|not found/i);
  const handed = repo.passBaton('friend', 'check', '2026-08-31T12:00:00Z');
  assert.equal(handed.holderUserId, 'friend');
  assert.equal(repo.getState().batonHandoffs.length, 1);
  assert.throws(() => repo.passBaton('me', 'check', '2026-08-31T12:01:00Z'), /holder|active/i);
});
