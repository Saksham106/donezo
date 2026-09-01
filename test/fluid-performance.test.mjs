import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLatestIntentCoordinator } from '../src/optimistic.js';
import { createStateCacheEnvelope, validateStateCacheEnvelope } from '../src/state-cache.js';

const [app, store, social, sw, pkg] = await Promise.all([
  readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/store.js', import.meta.url), 'utf8'),
  readFile(new URL('../social.css', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  import('../package.json', { with: { type: 'json' } }).then((module) => module.default),
]);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0, `Missing section start: ${start}`);
  assert.ok(endAt > startAt, `Missing section end: ${end}`);
  return source.slice(startAt, endAt);
}

test('latest-intent coordinator serializes a key and skips superseded intermediate values', async () => {
  let releaseFirst;
  const persisted = [];
  const coordinator = createLatestIntentCoordinator({
    persist: async (_key, value) => {
      persisted.push(value);
      if (persisted.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });

  const first = coordinator.setDesired('proof-1', '🔥', null);
  coordinator.setDesired('proof-1', '👏', null);
  coordinator.setDesired('proof-1', '💪', null);
  await Promise.resolve();
  releaseFirst();
  await first;
  await coordinator.whenIdle('proof-1');

  assert.deepEqual(persisted, ['🔥', '💪']);
  assert.equal(coordinator.getState('proof-1').confirmed, '💪');
});

test('a stale failed write never rolls back newer desired reaction intent', async () => {
  let rejectFirst;
  const failures = [];
  const coordinator = createLatestIntentCoordinator({
    persist: async (_key, value) => {
      if (value === '🔥') await new Promise((_resolve, reject) => { rejectFirst = reject; });
    },
    onFinalFailure: (_key, context) => failures.push(context),
  });

  coordinator.setDesired('proof-1', '🔥', null);
  coordinator.setDesired('proof-1', '👏', null);
  await Promise.resolve();
  rejectFirst(new Error('network'));
  await coordinator.whenIdle('proof-1');

  assert.equal(coordinator.getState('proof-1').desired, '👏');
  assert.equal(coordinator.getState('proof-1').confirmed, '👏');
  assert.equal(failures.length, 0);
});

test('a final failed desired value reports rollback context without changing confirmed value', async () => {
  const failures = [];
  const coordinator = createLatestIntentCoordinator({
    persist: async () => { throw new Error('nope'); },
    onFinalFailure: (_key, context) => failures.push(context),
  });
  await coordinator.setDesired('proof-1', '🔥', '👏');
  await coordinator.whenIdle('proof-1');
  assert.equal(coordinator.getState('proof-1').desired, '👏');
  assert.equal(coordinator.getState('proof-1').confirmed, '👏');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failedValue, '🔥');
  assert.equal(failures[0].rollbackValue, '👏');
});

test('state cache envelope accepts only the current user, schema, and seven-day freshness window', () => {
  const now = Date.UTC(2026, 7, 31, 12);
  const state = { currentUserId: 'user-1', habits: [{ id: 'h1' }] };
  const envelope = createStateCacheEnvelope('user-1', state, now);
  assert.deepEqual(validateStateCacheEnvelope(envelope, 'user-1', now + 1000), state);
  assert.equal(validateStateCacheEnvelope(envelope, 'user-2', now + 1000), null);
  assert.equal(validateStateCacheEnvelope(envelope, 'user-1', now + 8 * 24 * 60 * 60 * 1000), null);
  assert.equal(validateStateCacheEnvelope({ ...envelope, schemaVersion: 99 }, 'user-1', now + 1000), null);
});

test('repository exposes a fast peek/hydrate path and hot persistence methods avoid full load', () => {
  assert.match(store, /peekState\(\)\s*\{\s*return state;\s*\}/);
  assert.match(store, /hydrateState\(cachedState\)/);
  assert.match(store, /async function setPositiveReaction/);
  assert.match(store, /async function setProofDownvote/);
  assert.match(store, /async function toggleSimpleCheckIn/);
  assert.match(store, /async function addComment/);
  assert.match(store, /async function deleteComment/);
  assert.match(store, /async function markNudgeRead/);

  for (const [start, end] of [
    ['async function setPositiveReaction', 'async function setProofDownvote'],
    ['async function setProofDownvote', 'async function setHabitAudience'],
    ['async function toggleSimpleCheckIn', 'async function toggleHabit'],
    ['async function addComment', 'async function deleteComment'],
    ['async function deleteComment', 'async function createFriendInvite'],
    ['async function markNudgeRead', 'async function createChallenge'],
  ]) {
    const hotPath = section(store, start, end);
    assert.doesNotMatch(hotPath, /return load\(\)/);
    assert.doesNotMatch(hotPath, /await load\(\)/);
  }
});

test('app routes hot interactions through optimistic state rather than global runMutation', () => {
  assert.match(app, /createLatestIntentCoordinator/);
  assert.match(app, /runOptimisticMutation/);
  assert.match(app, /repo\.applyPositiveReaction/);
  assert.match(app, /repo\.applySimpleCheckIn/);
  assert.match(app, /repo\.applyProofDownvote/);
  assert.match(app, /repo\.applyOptimisticComment/);
  assert.match(app, /repo\.applyNudgeRead/);

  const reaction = section(app, 'async function handleReaction', 'async function handleDownvote');
  assert.doesNotMatch(reaction, /runMutation\(/);
  assert.match(reaction, /reactionCoordinator\.setDesired/);
  const simple = section(app, 'async function handleSimpleCheckIn', 'async function handleUndoSimpleCheckIn');
  assert.doesNotMatch(simple, /runMutation\(/);
  const comment = section(app, 'async function handleCommentSubmit', 'async function handleUndoCommentDelete');
  assert.doesNotMatch(comment, /runMutation\(/);
});

test('warm startup reads user cache before authoritative load and sign-out clears it', () => {
  const boot = section(app, 'async function boot(', 'for (const eventName');
  assert.match(boot, /readStateCache/);
  assert.match(boot, /hydrateState/);
  assert.ok(boot.indexOf('readStateCache') < boot.indexOf('activeRepo.load()'));
  assert.match(boot, /writeStateCache/);
  const signOut = section(app, 'async function handleSignOut()', 'function authView');
  assert.match(signOut, /clearStateCache/);
});

test('cached startup stays read-only until an authoritative load succeeds', () => {
  const mutation = section(app, 'async function runMutation(', 'function activityViewers');
  const optimistic = section(app, 'async function runOptimisticMutation(', 'function formatWhen');
  const reaction = section(app, 'async function handleReaction', 'async function handleDownvote');
  const proofSubmit = section(app, 'async function handleProofSubmit(', 'async function handleSimpleCheckIn');
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

test('proof viewer reuses a cached signed thumbnail URL before signing again', () => {
  const viewer = section(app, 'async function loadProofViewerUrl()', 'async function loadProofThumbnail(');
  assert.match(viewer, /proofThumbnailUrls\.get\(/);
  assert.match(viewer, /repo\.getProofUrl/);
  assert.ok(viewer.indexOf('proofThumbnailUrls.get(') < viewer.indexOf('repo.getProofUrl'));
});

test('new performance modules are syntax-checked and shell cache advances to v26', () => {
  assert.match(pkg.scripts.check, /src\/optimistic\.js/);
  assert.match(pkg.scripts.check, /src\/state-cache\.js/);
  assert.match(sw, /donezo-shell-v26/);
  assert.doesNotMatch(sw, /donezo-shell-v25/);
});
