export const STATE_CACHE_SCHEMA_VERSION = 1;
export const STATE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DB_NAME = 'donezo-state-cache';
const DB_VERSION = 1;
const STORE_NAME = 'states';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

async function openStateCache(indexedDBTarget) {
  if (!indexedDBTarget?.open) return null;
  const request = indexedDBTarget.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'userId' });
  };
  return requestResult(request);
}

export function validateStateCacheEnvelope(envelope, userId, now = Date.now()) {
  if (!envelope || typeof envelope !== 'object' || !userId) return null;
  if (envelope.schemaVersion !== STATE_CACHE_SCHEMA_VERSION || envelope.userId !== userId) return null;
  const savedAt = Date.parse(envelope.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const age = Number(now) - savedAt;
  if (age < 0 || age > STATE_CACHE_MAX_AGE_MS) return null;
  const state = envelope.state;
  if (!state || typeof state !== 'object' || state.currentUserId !== userId) return null;
  return state;
}

export async function readStateCache(userId, {
  indexedDBTarget = globalThis.indexedDB,
  now = Date.now(),
} = {}) {
  if (!userId || !indexedDBTarget?.open) return null;
  let database;
  try {
    database = await openStateCache(indexedDBTarget);
    if (!database) return null;
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const envelope = await requestResult(transaction.objectStore(STORE_NAME).get(userId));
    return validateStateCacheEnvelope(envelope, userId, now);
  } catch {
    return null;
  } finally {
    database?.close?.();
  }
}

export async function writeStateCache(userId, state, {
  indexedDBTarget = globalThis.indexedDB,
  now = Date.now(),
} = {}) {
  if (!userId || !state || state.currentUserId !== userId || !indexedDBTarget?.open) return false;
  let database;
  try {
    database = await openStateCache(indexedDBTarget);
    if (!database) return false;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      schemaVersion: STATE_CACHE_SCHEMA_VERSION,
      userId,
      savedAt: new Date(now).toISOString(),
      state,
    });
    await transactionDone(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database?.close?.();
  }
}

export async function clearStateCache(userId, {
  indexedDBTarget = globalThis.indexedDB,
} = {}) {
  if (!userId || !indexedDBTarget?.open) return false;
  let database;
  try {
    database = await openStateCache(indexedDBTarget);
    if (!database) return false;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(userId);
    await transactionDone(transaction);
    return true;
  } catch {
    return false;
  } finally {
    database?.close?.();
  }
}
