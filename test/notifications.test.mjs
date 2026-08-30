import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotificationEvent,
  evaluateNotificationPreferences,
  getNotificationDeepLink,
  getNotificationCopy,
  isWithinQuietHours,
  notificationDedupeKey,
  getNotificationCapability,
  urlBase64ToUint8Array,
} from '../src/notifications.js';

test('reports unsupported when Notification or service workers are unavailable', () => {
  assert.deepEqual(getNotificationCapability({}), { supported: false, permission: 'unsupported' });
});

test('reports current permission when browser APIs exist', () => {
  const env = { Notification: { permission: 'granted' }, navigator: { serviceWorker: {} } };
  assert.deepEqual(getNotificationCapability(env), { supported: true, permission: 'granted' });
});

test('urlBase64ToUint8Array decodes VAPID application server keys', () => {
  const bytes = urlBase64ToUint8Array('AQIDBA');
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test('quiet hours honor overnight windows in the preference timezone', () => {
  const preferences = {
    timezone: 'America/New_York',
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
  };
  assert.equal(isWithinQuietHours('2026-08-29T03:30:00.000Z', preferences), true);
  assert.equal(isWithinQuietHours('2026-08-29T13:00:00.000Z', preferences), false);
});

test('category and habit controls are evaluated before delivery', () => {
  const preferences = {
    timezone: 'UTC',
    categories: { due_soon: false, streak_risk: true },
    habitOverrides: { 'habit-1': { due_soon: true }, 'habit-2': false },
  };
  assert.deepEqual(evaluateNotificationPreferences({ category: 'due_soon', habitId: 'habit-1', at: '2026-08-29T12:00:00Z', preferences }), { allowed: true, reason: 'allowed' });
  assert.deepEqual(evaluateNotificationPreferences({ category: 'due_soon', habitId: 'habit-2', at: '2026-08-29T12:00:00Z', preferences }), { allowed: false, reason: 'habit_disabled' });
  assert.deepEqual(evaluateNotificationPreferences({ category: 'due_soon', habitId: 'habit-3', at: '2026-08-29T12:00:00Z', preferences }), { allowed: false, reason: 'category_disabled' });
});

test('dedupe keys are deterministic and events carry grouping and exact targets', () => {
  const input = {
    recipientUserId: 'user-1',
    category: 'streak_risk',
    habitId: 'habit-1',
    occurrence: '2026-08-29',
    at: '2026-08-29T18:00:00Z',
    preferences: { timezone: 'UTC' },
    context: { habitTitle: 'Read', habitId: 'habit-1' },
  };
  const first = buildNotificationEvent(input);
  const second = buildNotificationEvent({ ...input });
  assert.deepEqual(first, second);
  assert.equal(first.dedupeKey, notificationDedupeKey(input));
  assert.equal(first.groupKey, 'user-1:streak_risk:habit-1');
  assert.equal(first.deepLink, '/?tab=checkin&habit=habit-1');
  assert.match(first.title, /streak/i);
  assert.doesNotMatch(`${first.title} ${first.body}`, /shame|lazy|failure|loser/i);
});

test('deep links reject missing context instead of falling back to the home screen', () => {
  assert.equal(getNotificationDeepLink('nudge', { nudgeId: 'nudge-1' }), '/?nudges=1');
  assert.throws(() => getNotificationDeepLink('reaction', {}), /checkInId/);
  assert.match(getNotificationCopy('friend_activity', { actorName: 'Maya', habitTitle: 'Run' }).body, /Maya|Run/);
});

test('event construction suppresses quiet-hour delivery without losing deterministic identity', () => {
  const event = buildNotificationEvent({
    recipientUserId: 'user-1',
    category: 'due_soon',
    habitId: 'habit-1',
    occurrence: '2026-08-29',
    at: '2026-08-29T03:30:00Z',
    preferences: {
      timezone: 'America/New_York',
      quietHours: { enabled: true, start: '22:00', end: '08:00' },
    },
    context: { habitTitle: 'Read' },
  });
  assert.equal(event, null);
  assert.notEqual(
    notificationDedupeKey({ recipientUserId: 'user-1', category: 'due_soon', habitId: 'habit-1', occurrence: '2026-08-29' }),
    notificationDedupeKey({ recipientUserId: 'user-1', category: 'due_soon', habitId: 'habit-1', occurrence: '2026-08-30' }),
  );
  assert.notEqual(
    notificationDedupeKey({ recipientUserId: 'user-1', category: 'reaction', habitId: 'habit-1', checkInId: 'check-in-1' }),
    notificationDedupeKey({ recipientUserId: 'user-1', category: 'reaction', habitId: 'habit-1', checkInId: 'check-in-2' }),
  );
});
