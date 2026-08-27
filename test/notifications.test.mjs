import test from 'node:test';
import assert from 'node:assert/strict';
import { getNotificationCapability } from '../src/notifications.js';

test('reports unsupported when Notification or service workers are unavailable', () => {
  assert.deepEqual(getNotificationCapability({}), { supported: false, permission: 'unsupported' });
});

test('reports current permission when browser APIs exist', () => {
  const env = { Notification: { permission: 'granted' }, navigator: { serviceWorker: {} } };
  assert.deepEqual(getNotificationCapability(env), { supported: true, permission: 'granted' });
});
