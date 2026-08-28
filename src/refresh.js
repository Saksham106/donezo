export function createRefreshCoordinator({
  refresh,
  isVisible = () => true,
  isOnline = () => true,
  isBusy = () => false,
  onNetworkChange = () => {},
  documentTarget = globalThis.document,
  windowTarget = globalThis.window,
  intervalMs = 30_000,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
} = {}) {
  if (typeof refresh !== 'function') throw new TypeError('refresh must be a function');

  let started = false;
  let timerId = null;
  let inFlight = null;

  function request(reason = 'background') {
    if (!started) return Promise.resolve({ status: 'skipped', reason: 'stopped' });
    if (inFlight) return inFlight;
    if (isBusy()) return Promise.resolve({ status: 'skipped', reason: 'busy' });
    if (!isOnline()) return Promise.resolve({ status: 'skipped', reason: 'offline' });
    if (reason !== 'manual' && !isVisible()) return Promise.resolve({ status: 'skipped', reason: 'hidden' });

    inFlight = (async () => {
      try {
        await refresh(reason);
        return { status: 'refreshed', reason };
      } catch (error) {
        return { status: 'failed', reason, error };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  const handleVisibility = () => {
    if (isVisible()) void request('visibility');
  };
  const handleFocus = () => { void request('focus'); };
  const handleOnline = () => {
    onNetworkChange(true);
    void request('online');
  };
  const handleOffline = () => { onNetworkChange(false); };

  function start() {
    if (started) return;
    started = true;
    documentTarget?.addEventListener?.('visibilitychange', handleVisibility);
    windowTarget?.addEventListener?.('focus', handleFocus);
    windowTarget?.addEventListener?.('online', handleOnline);
    windowTarget?.addEventListener?.('offline', handleOffline);
    timerId = setIntervalFn(() => { void request('interval'); }, intervalMs);
  }

  function stop() {
    if (!started) return;
    started = false;
    documentTarget?.removeEventListener?.('visibilitychange', handleVisibility);
    windowTarget?.removeEventListener?.('focus', handleFocus);
    windowTarget?.removeEventListener?.('online', handleOnline);
    windowTarget?.removeEventListener?.('offline', handleOffline);
    if (timerId !== null) clearIntervalFn(timerId);
    timerId = null;
  }

  function waitForIdle() {
    return inFlight || Promise.resolve();
  }

  return {
    start,
    stop,
    request,
    waitForIdle,
    isRefreshing: () => Boolean(inFlight),
  };
}
