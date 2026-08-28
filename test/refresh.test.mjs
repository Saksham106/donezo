import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCoordinator } from '../src/refresh.js';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }

  count(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const documentTarget = new FakeEventTarget();
  const windowTarget = new FakeEventTarget();
  let visible = true;
  let online = true;
  let busy = false;
  let intervalCallback = null;
  let clearedTimer = null;
  const calls = [];
  const networkChanges = [];

  const coordinator = createRefreshCoordinator({
    refresh: async (reason) => { calls.push(reason); },
    isVisible: () => visible,
    isOnline: () => online,
    isBusy: () => busy,
    onNetworkChange: (value) => networkChanges.push(value),
    documentTarget,
    windowTarget,
    intervalMs: 30_000,
    setIntervalFn: (callback, ms) => {
      assert.equal(ms, 30_000);
      intervalCallback = callback;
      return 77;
    },
    clearIntervalFn: (id) => { clearedTimer = id; },
    ...overrides,
  });

  return {
    coordinator,
    documentTarget,
    windowTarget,
    calls,
    networkChanges,
    interval: () => intervalCallback?.(),
    setVisible: (value) => { visible = value; },
    setOnline: (value) => { online = value; },
    setBusy: (value) => { busy = value; },
    clearedTimer: () => clearedTimer,
  };
}

test('refreshes on visibility, focus, online and the 30 second interval only while eligible', async () => {
  const h = harness();
  h.coordinator.start();

  h.setVisible(false);
  h.documentTarget.dispatch('visibilitychange');
  h.interval();
  await settle();
  assert.deepEqual(h.calls, []);

  h.setVisible(true);
  h.documentTarget.dispatch('visibilitychange');
  await settle();
  h.windowTarget.dispatch('focus');
  await settle();
  h.windowTarget.dispatch('online');
  await settle();
  h.interval();
  await settle();

  assert.deepEqual(h.calls, ['visibility', 'focus', 'online', 'interval']);
});

test('skips busy/offline requests and de-duplicates concurrent refreshes', async () => {
  const gate = deferred();
  let refreshCalls = 0;
  const h = harness({
    refresh: async () => {
      refreshCalls += 1;
      await gate.promise;
    },
  });
  h.coordinator.start();

  h.setBusy(true);
  assert.deepEqual(await h.coordinator.request('manual'), { status: 'skipped', reason: 'busy' });
  h.setBusy(false);
  h.setOnline(false);
  assert.deepEqual(await h.coordinator.request('manual'), { status: 'skipped', reason: 'offline' });

  h.setOnline(true);
  const first = h.coordinator.request('manual');
  const second = h.coordinator.request('focus');
  assert.equal(refreshCalls, 1);
  gate.resolve();
  assert.deepEqual(await first, { status: 'refreshed', reason: 'manual' });
  assert.deepEqual(await second, { status: 'refreshed', reason: 'manual' });
  assert.equal(refreshCalls, 1);
});

test('reports network changes and removes timers/listeners when stopped', async () => {
  const h = harness();
  h.coordinator.start();
  assert.equal(h.documentTarget.count('visibilitychange'), 1);
  assert.equal(h.windowTarget.count('focus'), 1);
  assert.equal(h.windowTarget.count('online'), 1);
  assert.equal(h.windowTarget.count('offline'), 1);

  h.setOnline(false);
  h.windowTarget.dispatch('offline');
  assert.deepEqual(h.networkChanges, [false]);

  h.coordinator.stop();
  assert.equal(h.clearedTimer(), 77);
  assert.equal(h.documentTarget.count('visibilitychange'), 0);
  assert.equal(h.windowTarget.count('focus'), 0);
  assert.equal(h.windowTarget.count('online'), 0);
  assert.equal(h.windowTarget.count('offline'), 0);

  h.setOnline(true);
  h.windowTarget.dispatch('focus');
  h.windowTarget.dispatch('online');
  h.documentTarget.dispatch('visibilitychange');
  h.interval();
  await settle();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await h.coordinator.request('manual'), { status: 'skipped', reason: 'stopped' });
});
