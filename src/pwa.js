const DEFAULT_SERVICE_WORKER_URL = '/sw.js';

function hasServiceWorker(navigatorTarget) {
  return Boolean(navigatorTarget?.serviceWorker?.register);
}

/**
 * Owns the service-worker lifecycle without deciding when an update is safe to apply.
 * The application can subscribe to update availability and call applyUpdate() after
 * it has saved or dismissed any in-progress work.
 */
export function createPwaController({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  serviceWorkerUrl = DEFAULT_SERVICE_WORKER_URL,
  onUpdateAvailable: initialUpdateCallback,
  reload = () => windowTarget?.location?.reload?.(),
} = {}) {
  const supported = hasServiceWorker(navigatorTarget);
  const serviceWorker = navigatorTarget?.serviceWorker;
  const listeners = new Set();
  const watchedWorkers = new Map();

  let registration = null;
  let waitingWorker = null;
  let started = false;
  let applying = false;
  let reloadRequested = false;
  let didReload = false;
  let startPromise = null;

  const getState = () => ({
    supported,
    started,
    updateAvailable: Boolean(waitingWorker),
    applying,
    reloadRequested,
  });

  function notifyUpdateAvailable() {
    const state = getState();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // One integration callback must not break the service-worker lifecycle.
      }
    }
  }

  function setWaiting(worker) {
    if (!worker || waitingWorker === worker || !serviceWorker?.controller) return;
    waitingWorker = worker;
    notifyUpdateAvailable();
  }

  function watchInstalling(worker) {
    if (!worker?.addEventListener || watchedWorkers.has(worker)) return;
    const handleStateChange = () => {
      if (worker.state === 'installed') setWaiting(worker);
      if (worker.state === 'redundant' && waitingWorker === worker) {
        waitingWorker = null;
        applying = false;
        reloadRequested = false;
      }
    };
    watchedWorkers.set(worker, handleStateChange);
    worker.addEventListener('statechange', handleStateChange);
  }

  function handleUpdateFound() {
    watchInstalling(registration?.installing);
  }

  function handleControllerChange() {
    if (!reloadRequested || didReload) return;
    didReload = true;
    applying = false;
    reloadRequested = false;
    reload();
  }

  async function checkForUpdate() {
    if (!supported) return false;
    if (!registration) await start();
    if (!registration?.update) return Boolean(waitingWorker);
    await registration.update();
    if (registration.waiting) setWaiting(registration.waiting);
    return Boolean(waitingWorker);
  }

  async function start() {
    if (!supported) return null;
    if (startPromise) return startPromise;

    startPromise = (async () => {
      registration = await serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' });
      started = true;
      registration.addEventListener?.('updatefound', handleUpdateFound);
      serviceWorker.addEventListener?.('controllerchange', handleControllerChange);
      documentTarget?.addEventListener?.('visibilitychange', handleVisibilityChange);
      windowTarget?.addEventListener?.('focus', handleFocus);
      watchInstalling(registration.installing);
      setWaiting(registration.waiting);
      if (registration.update) await registration.update();
      return registration;
    })();

    try {
      return await startPromise;
    } catch (error) {
      started = false;
      registration = null;
      throw error;
    } finally {
      startPromise = null;
    }
  }

  function handleVisibilityChange() {
    if (documentTarget?.visibilityState === 'visible') void checkForUpdate();
  }

  function handleFocus() {
    void checkForUpdate();
  }

  function onUpdateAvailable(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    listeners.add(callback);
    if (waitingWorker) {
      try {
        callback(getState());
      } catch {
        // A late subscriber must not affect update handling.
      }
    }
    return () => listeners.delete(callback);
  }

  function applyUpdate() {
    if (didReload || reloadRequested) return reloadRequested;
    const worker = waitingWorker || registration?.waiting;
    if (!worker?.postMessage) return false;
    waitingWorker = worker;
    applying = true;
    reloadRequested = true;
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch {
      applying = false;
      reloadRequested = false;
      return false;
    }
  }

  function stop() {
    if (!started) return;
    started = false;
    registration?.removeEventListener?.('updatefound', handleUpdateFound);
    serviceWorker?.removeEventListener?.('controllerchange', handleControllerChange);
    documentTarget?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    windowTarget?.removeEventListener?.('focus', handleFocus);
    for (const [worker, handler] of watchedWorkers) {
      worker.removeEventListener?.('statechange', handler);
    }
    watchedWorkers.clear();
  }

  if (initialUpdateCallback) onUpdateAvailable(initialUpdateCallback);

  const controller = {
    start,
    stop,
    checkForUpdate,
    applyUpdate,
    onUpdateAvailable,
    getState,
  };

  Object.defineProperties(controller, {
    updateAvailable: { enumerable: true, get: () => Boolean(waitingWorker) },
    registration: { enumerable: true, get: () => registration },
  });

  return controller;
}

if (typeof window !== 'undefined' && hasServiceWorker(window.navigator)) {
  const controller = createPwaController();
  window.DonezoPWA = controller;
  void controller.start().catch(() => {});
}
