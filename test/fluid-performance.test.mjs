import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLatestIntentCoordinator } from '../src/optimistic.js';
import {
  STATE_CACHE_MAX_AGE_MS,
  STATE_CACHE_SCHEMA_VERSION,
  validateStateCacheEnvelope,
} from '../src/state-cache.js';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 ? source.slice(from, to >= 0 ? to : undefined) : '';
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('latest-intent coordinator serializes a key and skips superseded intermediate values', async () => {
  const first = deferred();
  const writes = [];
  const confirmed = [];
  const coordinator = createLatestIntentCoordinator({
    yieldToPaint: async () => {},
    persist: async (_key, value) => {
      writes.push(value);
      if (writes.length === 1) await first.promise;
      return value;
    },
    onConfirmed: (key, value) => confirmed.push([key, value]),
  });

  coordinator.queue('reaction:proof-1', '🔥', { confirmed: null });
  await tick();
  coordinator.queue('reaction:proof-1', '👏');
  coordinator.queue('reaction:proof-1', '😂');

  assert.deepEqual(writes, ['🔥']);
  assert.equal(coordinator.desired('reaction:proof-1'), '😂');

  first.resolve();
  await coordinator.whenIdle('reaction:proof-1');

  assert.deepEqual(writes, ['🔥', '😂']);
  assert.equal(coordinator.confirmed('reaction:proof-1'), '😂');
  assert.equal(coordinator.isPending('reaction:proof-1'), false);
  assert.deepEqual(confirmed.at(-1), ['reaction:proof-1', '😂']);
});

test('a stale failed write never rolls back newer desired reaction intent', async () => {
  const first = deferred();
  const writes = [];
  const errors = [];
  const coordinator = createLatestIntentCoordinator({
    yieldToPaint: async () => {},
    persist: async (_key, value) => {
      writes.push(value);
      if (writes.length === 1) return first.promise;
      return value;
    },
    onError: (details) => errors.push(details),
  });

  coordinator.queue('reaction:proof-2', '🔥', { confirmed: null });
  await tick();
  coordinator.queue('reaction:proof-2', '💪');
  first.reject(new Error('old request failed'));

  await coordinator.whenIdle('reaction:proof-2');

  assert.deepEqual(writes, ['🔥', '💪']);
  assert.equal(coordinator.confirmed('reaction:proof-2'), '💪');
  assert.equal(errors.length, 0);
});

test('a final failed desired value reports rollback context without changing confirmed value', async () => {
  const errors = [];
  const coordinator = createLatestIntentCoordinator({
    yieldToPaint: async () => {},
    persist: async () => { throw new Error('network down'); },
    onError: (details) => errors.push(details),
  });

  coordinator.queue('reaction:proof-3', '👏', { confirmed: '🔥' });
  await coordinator.whenIdle('reaction:proof-3');

  assert.equal(coordinator.confirmed('reaction:proof-3'), '🔥');
  assert.equal(coordinator.desired('reaction:proof-3'), '🔥');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].key, 'reaction:proof-3');
  assert.equal(errors[0].failed, '👏');
  assert.equal(errors[0].confirmed, '🔥');
});

test('state cache envelope accepts only the current user, schema, and seven-day freshness window', () => {
  const now = Date.parse('2026-08-31T21:00:00Z');
  const valid = {
    schemaVersion: STATE_CACHE_SCHEMA_VERSION,
    userId: 'user-1',
    savedAt: new Date(now - 1_000).toISOString(),
    state: { currentUserId: 'user-1', habits: [] },
  };

  assert.deepEqual(validateStateCacheEnvelope(valid, 'user-1', now), valid.state);
  assert.equal(validateStateCacheEnvelope({ ...valid, userId: 'user-2' }, 'user-1', now), null);
  assert.equal(validateStateCacheEnvelope({ ...valid, schemaVersion: STATE_CACHE_SCHEMA_VERSION + 1 }, 'user-1', now), null);
  assert.equal(validateStateCacheEnvelope({ ...valid, savedAt: new Date(now - STATE_CACHE_MAX_AGE_MS - 1).toISOString() }, 'user-1', now), null);
  assert.equal(validateStateCacheEnvelope({ ...valid, state: { currentUserId: 'other' } }, 'user-1', now), null);
});

test('repository exposes a fast peek/hydrate path and hot persistence methods avoid full load', () => {
  assert.match(store, /function peekState\(\)/);
  assert.match(store, /function hydrateState\(/);

  for (const [start, end] of [
    ['async function setPositiveReaction(', 'async function recoverHabit('],
    ['async function setProofDownvote(', 'async function setPositiveReaction('],
    ['async function toggleSimpleCheckIn(', 'async function completeWithProof('],
    ['async function addComment(', 'async function deleteComment('],
    ['async function deleteComment(', 'function getEarnedBadges('],
    ['async function markNudgeRead(', 'async function startBaton('],
  ]) {
    const body = section(store, start, end);
    assert.notEqual(body, '', `missing ${start}`);
    assert.doesNotMatch(body, /\bload\s*\(/, `${start} must not full reload`);
  }
});

test('app routes hot interactions through optimistic state rather than global runMutation', () => {
  assert.match(app, /createLatestIntentCoordinator/);
  assert.match(app, /scheduleReconciliation/);
  assert.match(app, /reapplyOptimisticPatches/);

  for (const [start, end] of [
    ['async function handleReaction(', 'async function handleCommentSubmit('],
    ['async function handleDownvote(', 'async function handleReaction('],
    ['async function handleCommentSubmit(', 'async function handleUndoCommentDelete('],
  ]) {
    const body = section(app, start, end);
    assert.notEqual(body, '', `missing ${start}`);
    assert.doesNotMatch(body, /runMutation\s*\(/, `${start} should not use global mutation lane`);
  }

  assert.match(app, /toggleSimpleCheckIn/);
  assert.match(app, /markNudgeReadOptimistic/);
});

test('warm startup reads user cache before authoritative load and sign-out clears it', () => {
  const boot = section(app, 'async function boot(', 'for (const eventName');
  const cacheRead = boot.indexOf('readStateCache(');
  const load = boot.indexOf('activeRepo.load(');
  assert.ok(cacheRead >= 0 && load >= 0 && cacheRead < load);
  assert.match(boot, /hydrateState\(/);
  assert.match(boot, /scheduleStateCacheWrite/);
  assert.match(section(app, 'async function handleSignOut(', 'proofInput.addEventListener'), /clearStateCache\(/);
});

test('cached startup stays read-only until an authoritative load succeeds', () => {
  assert.match(app, /let authoritativeReady = false/);
  const refresh = section(app, 'async function refreshRepositoryData(', 'function startRefreshCoordinator');
  assert.match(refresh, /authoritativeReady = true/);

  const mutation = section(app, 'async function runMutation(', 'async function handleAuth');
  const optimistic = section(app, 'async function runOptimisticMutation(', 'function formatWhen');
  const reaction = section(app, 'async function handleReaction(', 'async function handleCommentSubmit');
  const proofSubmit = section(app, 'async function handleProofSubmit()', 'async function loadProofViewerUrl()');
  assert.match(mutation, /!authoritativeReady/);
  assert.match(optimistic, /!authoritativeReady/);
  assert.match(reaction, /!authoritativeReady/);
  assert.match(proofSubmit, /!authoritativeReady/);

  const boot = section(app, 'async function boot(', 'for (const eventName');
  assert.match(boot, /authoritativeReady = false/);
  assert.match(boot, /authoritativeReady = true/);
  const cachedFailure = boot.slice(boot.indexOf('if (cachedRendered)'));
  assert.doesNotMatch(cachedFailure.slice(0, cachedFailure.indexOf('stopRefreshCoordinator')), /authoritativeReady = true/);
});

test('Friends list primes a fresh invite before the tap so native share keeps user activation', () => {
  assert.match(app, /let prefetchedFriendInvite = null/);
  assert.match(app, /function primeFriendInvite\(/);
  const peopleOpen = section(app, "app.querySelectorAll('[data-people-open]')", "app.querySelectorAll('[data-invite-from-people]')");
  assert.match(peopleOpen, /primeFriendInvite\(\)/);

  const share = section(app, 'async function handleShareInvite()', 'function clearPendingInvite()');
  assert.match(share, /prefetchedFriendInvite/);
  assert.match(share, /sharePreparedInvite/);
  assert.doesNotMatch(share, /await handleCreateFriendInvite\(/);

  const preparedShare = section(app, 'async function sharePreparedInvite(', 'async function handleShareInvite()');
  assert.match(preparedShare, /navigator\.share\(payload\)/);
  const firstAwait = preparedShare.indexOf('await ');
  const shareCall = preparedShare.indexOf('navigator.share(payload)');
  assert.ok(shareCall >= 0 && firstAwait === shareCall - 'await '.length, 'navigator.share must be the first awaited operation');
});

test('optimistic reply success refreshes server ids and undo contains no dead event scaffolding', () => {
  const submit = section(app, 'async function handleCommentSubmit(', 'async function handleUndoCommentDelete(');
  const replace = submit.indexOf('repo.replaceOptimisticComment(temp.id, saved)');
  const rerender = submit.indexOf('renderPreservingScroll()', replace);
  assert.ok(replace >= 0 && rerender > replace);
  const undo = section(app, 'async function handleUndoCommentDelete(', 'async function handleDeleteComment(');
  assert.doesNotMatch(undo, /fakeEvent/);
});

test('Friends list uses one action row and Invite friends goes straight to share flow', () => {
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  assert.match(people, /people-growth-actions/);
  assert.match(people, /data-invite-from-people/);
  assert.match(people, /data-add-friend-from-people/);
  assert.match(social, /\.people-growth-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);

  const bind = section(app, "app.querySelectorAll('[data-invite-from-people]')", "app.querySelectorAll('[data-add-friend-from-people]')");
  assert.match(bind, /handleShareInvite/);
  assert.doesNotMatch(bind, /inviteSheetOpen\s*=\s*true/);
});

test('inline proof image loader reuses a cached signed URL before signing again', () => {
  const loader = section(app, 'async function loadProofThumbnail(', 'function bindProofThumbnails(');
  assert.match(loader, /proofThumbnailUrls\.get\(/);
  assert.match(loader, /repo\.getProofUrl/);
  assert.ok(loader.indexOf('proofThumbnailUrls.get(') < loader.indexOf('repo.getProofUrl'));
  assert.match(loader, /proofThumbnailUrls\.set\(/);
});

test('new performance modules are syntax-checked and shell cache advances to v27', () => {
  assert.match(pkg.scripts.check, /src\/optimistic\.js/);
  assert.match(pkg.scripts.check, /src\/state-cache\.js/);
  assert.match(sw, /donezo-shell-v27/);
  assert.doesNotMatch(sw, /donezo-shell-v25/);
});
