import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPwaController } from '../src/pwa.js';

class FakeWorker extends EventTarget {
  constructor(state = 'installing') {
    super();
    this.state = state;
    this.messages = [];
  }

  postMessage(message) {
    this.messages.push(message);
  }
}

class FakeRegistration extends EventTarget {
  constructor() {
    super();
    this.installing = null;
    this.waiting = null;
    this.updateCalls = 0;
  }

  async update() {
    this.updateCalls += 1;
  }
}

class FakeServiceWorkerContainer extends EventTarget {
  constructor(registration) {
    super();
    this.registration = registration;
    this.controller = { id: 'current' };
    this.registerCalls = [];
  }

  async register(url, options) {
    this.registerCalls.push({ url, options });
    return this.registration;
  }
}

function createWindow() {
  const windowTarget = new EventTarget();
  windowTarget.location = { reloadCalls: 0, reload() { this.reloadCalls += 1; } };
  return windowTarget;
}

test('detects a waiting worker and notifies subscribers without reloading', async () => {
  const registration = new FakeRegistration();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const windowTarget = createWindow();
  const updates = [];
  const controller = createPwaController({
    navigatorTarget: { serviceWorker },
    windowTarget,
    onUpdateAvailable: (state) => updates.push(state),
  });
  const waiting = new FakeWorker('installed');
  registration.waiting = waiting;

  await controller.start();

  assert.equal(serviceWorker.registerCalls.length, 1);
  assert.equal(serviceWorker.registerCalls[0].url, '/sw.js');
  assert.equal(serviceWorker.registerCalls[0].options.updateViaCache, 'none');
  assert.equal(registration.updateCalls, 1);
  assert.equal(controller.getState().updateAvailable, true);
  assert.equal(updates.length, 1);
  assert.equal(windowTarget.location.reloadCalls, 0);
});

test('surfaces an installed worker from updatefound only when an active controller exists', async () => {
  const registration = new FakeRegistration();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const controller = createPwaController({ navigatorTarget: { serviceWorker }, windowTarget: createWindow() });
  await controller.start();

  const installing = new FakeWorker('installing');
  registration.installing = installing;
  registration.dispatchEvent(new Event('updatefound'));
  installing.state = 'installed';
  installing.dispatchEvent(new Event('statechange'));

  assert.equal(controller.getState().updateAvailable, true);

  const firstInstallRegistration = new FakeRegistration();
  const firstInstallServiceWorker = new FakeServiceWorkerContainer(firstInstallRegistration);
  firstInstallServiceWorker.controller = null;
  const firstInstall = createPwaController({
    navigatorTarget: { serviceWorker: firstInstallServiceWorker },
    windowTarget: createWindow(),
  });
  await firstInstall.start();
  const firstInstallWorker = new FakeWorker('installing');
  firstInstallRegistration.installing = firstInstallWorker;
  firstInstallRegistration.dispatchEvent(new Event('updatefound'));
  firstInstallWorker.state = 'installed';
  firstInstallWorker.dispatchEvent(new Event('statechange'));
  assert.equal(firstInstall.getState().updateAvailable, false);
});

test('applies a waiting update through SKIP_WAITING and reloads once per controller change', async () => {
  const registration = new FakeRegistration();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const windowTarget = createWindow();
  const controller = createPwaController({ navigatorTarget: { serviceWorker }, windowTarget });
  const waiting = new FakeWorker('installed');
  registration.waiting = waiting;
  await controller.start();

  assert.equal(controller.applyUpdate(), true);
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(controller.getState().applying, true);
  assert.equal(windowTarget.location.reloadCalls, 0);

  serviceWorker.dispatchEvent(new Event('controllerchange'));
  serviceWorker.dispatchEvent(new Event('controllerchange'));

  assert.equal(windowTarget.location.reloadCalls, 1);
  assert.equal(controller.getState().reloadRequested, false);
  assert.equal(controller.applyUpdate(), false);
});

test('does not auto-apply a waiting update before the parent explicitly accepts it', async () => {
  const registration = new FakeRegistration();
  const serviceWorker = new FakeServiceWorkerContainer(registration);
  const windowTarget = createWindow();
  const controller = createPwaController({ navigatorTarget: { serviceWorker }, windowTarget });
  const waiting = new FakeWorker('installed');
  registration.waiting = waiting;

  await controller.start();
  serviceWorker.dispatchEvent(new Event('controllerchange'));

  assert.deepEqual(waiting.messages, []);
  assert.equal(windowTarget.location.reloadCalls, 0);
});

test('ships the controller entry point and a versioned network-first shell worker', async () => {
  const [html, build, worker] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /name="mobile-web-app-capable" content="yes"/);
  assert.match(html, /<script type="module" src="\/pwa\.js"><\/script>/);
  assert.match(build, /cp\('src\/pwa\.js', 'dist\/pwa\.js'\)/);
  assert.match(worker, /donezo-shell-v10/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /cache:\s*'no-store'/);
  assert.doesNotMatch(worker, /self\.skipWaiting\(\);/);
});
