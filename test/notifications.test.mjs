import test from 'node:test';
import assert from 'node:assert/strict';
import { getNotificationCapability, urlBase64ToUint8Array } from '../src/notifications.js';

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
