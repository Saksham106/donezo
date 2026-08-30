import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthRedirectUrl,
  buildInviteLink,
  clearInviteParam,
  parseInviteParam,
  redeemInvite,
  validateInviteCode,
} from '../src/invite.js';

test('validateInviteCode normalizes valid codes and rejects malformed values', () => {
  assert.deepEqual(validateInviteCode('AbC123dEf456'), { valid: true, code: 'abc123def456' });
  assert.deepEqual(validateInviteCode(' short '), { valid: false, code: null });
  assert.deepEqual(validateInviteCode('abc123def45!'), { valid: false, code: null });
});

test('parseInviteParam preserves valid and malformed invite state without changing the URL', () => {
  assert.deepEqual(parseInviteParam('https://donezo.app/?invite=AbC123dEf456&x=1'), {
    present: true,
    valid: true,
    code: 'abc123def456',
    raw: 'AbC123dEf456',
  });
  assert.deepEqual(parseInviteParam('https://donezo.app/?invite=bad-code'), {
    present: true,
    valid: false,
    code: null,
    raw: 'bad-code',
  });
  assert.deepEqual(parseInviteParam('https://donezo.app/?x=1'), {
    present: false,
    valid: false,
    code: null,
    raw: null,
  });
});

test('buildInviteLink creates a shareable URL with only the normalized invite code', () => {
  assert.equal(
    buildInviteLink('https://donezo.app/app?old=1#section', 'AbC123dEf456'),
    'https://donezo.app/app?invite=abc123def456',
  );
});

test('buildAuthRedirectUrl preserves the invite through email confirmation', () => {
  assert.equal(
    buildAuthRedirectUrl('https://donezo.app/?invite=abc123def456&utm=friend#top', 'abc123def456'),
    'https://donezo.app/?invite=abc123def456',
  );
});

test('clearInviteParam removes only invite and preserves unrelated query and hash state', () => {
  assert.equal(
    clearInviteParam('https://donezo.app/?invite=abc123def456&utm=friend#top'),
    'https://donezo.app/?utm=friend#top',
  );
});

test('redeemInvite routes hardened codes directly to Friends', async () => {
  const calls = [];
  const repo = {
    acceptFriendInvite: async (code) => calls.push(['friend', code]),
    joinCircle: async (code) => calls.push(['circle', code]),
  };
  await redeemInvite(repo, 'abcdef0123456789abcdef01');
  assert.deepEqual(calls, [['friend', 'abcdef0123456789abcdef01']]);
});

test('redeemInvite preserves both legacy 12-character invite types', async () => {
  const friendCalls = [];
  await redeemInvite({
    acceptFriendInvite: async (code) => friendCalls.push(['friend', code]),
    joinCircle: async (code) => friendCalls.push(['circle', code]),
  }, 'abc123def456');
  assert.deepEqual(friendCalls, [['friend', 'abc123def456']]);

  const circleCalls = [];
  await redeemInvite({
    acceptFriendInvite: async (code) => {
      circleCalls.push(['friend', code]);
      throw new Error('Invalid or expired friend invite');
    },
    joinCircle: async (code) => circleCalls.push(['circle', code]),
  }, 'abc123def456');
  assert.deepEqual(circleCalls, [
    ['friend', 'abc123def456'],
    ['circle', 'abc123def456'],
  ]);
});