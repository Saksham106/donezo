const defaultYieldToPaint = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else queueMicrotask(resolve);
});

export function createLatestIntentCoordinator({
  persist,
  onConfirmed = () => {},
  onError = () => {},
  yieldToPaint = defaultYieldToPaint,
} = {}) {
  if (typeof persist !== 'function') throw new TypeError('persist must be a function');

  const entries = new Map();
  const waiters = new Map();

  function entryFor(key, initialConfirmed) {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        confirmed: initialConfirmed,
        desired: initialConfirmed,
        running: false,
      };
      entries.set(key, entry);
    }
    return entry;
  }

  function settleWaiters(key) {
    const pending = waiters.get(key);
    if (!pending?.length) return;
    waiters.delete(key);
    pending.forEach((resolve) => resolve());
  }

  async function run(key, entry) {
    if (entry.running) return;
    entry.running = true;
    try {
      await yieldToPaint();
      while (entry.desired !== entry.confirmed) {
        const attempted = entry.desired;
        try {
          const result = await persist(key, attempted, entry.confirmed);
          entry.confirmed = attempted;
          onConfirmed(key, attempted, result);
        } catch (error) {
          // A failed stale write must never erase newer intent. Keep working
          // toward the latest desired value instead of reporting a rollback.
          if (entry.desired !== attempted) continue;

          const confirmed = entry.confirmed;
          entry.desired = confirmed;
          onError({ key, failed: attempted, confirmed, error });
          break;
        }
      }
    } finally {
      entry.running = false;
      if (entry.desired !== entry.confirmed) {
        void run(key, entry);
      } else {
        settleWaiters(key);
      }
    }
  }

  function queue(key, desired, options = {}) {
    const hasConfirmed = Object.prototype.hasOwnProperty.call(options, 'confirmed');
    const entry = entryFor(key, hasConfirmed ? options.confirmed : undefined);
    entry.desired = desired;
    if (!entry.running) void run(key, entry);
    return desired;
  }

  function whenIdle(key) {
    const entry = entries.get(key);
    if (!entry || (!entry.running && entry.desired === entry.confirmed)) return Promise.resolve();
    return new Promise((resolve) => {
      const pending = waiters.get(key) || [];
      pending.push(resolve);
      waiters.set(key, pending);
    });
  }

  function pendingEntries() {
    return [...entries.entries()]
      .filter(([, entry]) => entry.running || entry.desired !== entry.confirmed)
      .map(([key, entry]) => ({ key, desired: entry.desired, confirmed: entry.confirmed }));
  }

  return {
    queue,
    whenIdle,
    desired: (key) => entries.get(key)?.desired,
    confirmed: (key) => entries.get(key)?.confirmed,
    isPending: (key) => {
      const entry = entries.get(key);
      return Boolean(entry && (entry.running || entry.desired !== entry.confirmed));
    },
    pendingEntries,
  };
}
