import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const cache = await readFile(new URL('../src/state-cache.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

test('latest-intent coordinator serializes a key and skips superseded intermediate values', async () => {
  const { createLatestIntentCoordinator } = await import('../src/optimistic.js');
  const calls = [];
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const coordinator = createLatestIntentCoordinator({
    persist: async (_key, value) => {
      calls.push(value);
      if (calls.length === 1) await first;
      return value;
    },
  });
  coordinator.queue('k', 'A', { confirmed: null });
  coordinator.queue('k', 'B');
  coordinator.queue('k', 'C');
  await Promise.resolve();
  assert.deepEqual(calls, ['A']);
  resolveFirst();
  await coordinator.whenIdle('k');
  assert.deepEqual(calls, ['A', 'C']);
  assert.equal(coordinator.confirmed('k'), 'C');
});

test('a stale failed write never rolls back newer desired reaction intent', async () => {
  const { createLatestIntentCoordinator } = await import('../src/optimistic.js');
  const calls = [];
  let rejectFirst;
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  const errors = [];
  const coordinator = createLatestIntentCoordinator({
    persist: async (_key, value) => {
      calls.push(value);
      if (calls.length === 1) return first;
      return value;
    },
    onError: (context) => errors.push(context),
  });
  coordinator.queue('reaction:1', '🔥', { confirmed: null });
  coordinator.queue('reaction:1', '👏');
  rejectFirst(new Error('stale'));
  await coordinator.whenIdle('reaction:1');
  assert.deepEqual(calls, ['🔥', '👏']);
  assert.equal(errors.length, 0);
  assert.equal(coordinator.confirmed('reaction:1'), '👏');
});

test('a final failed desired value reports rollback context without changing confirmed value', async () => {
  const { createLatestIntentCoordinator } = await import('../src/optimistic.js');
  const errors = [];
  const coordinator = createLatestIntentCoordinator({
    persist: async () => { throw new Error('nope'); },
    onError: (context) => errors.push(context),
  });
  coordinator.queue('reaction:1', '🔥', { confirmed: '👏' });
  await coordinator.whenIdle('reaction:1');
  assert.equal(coordinator.confirmed('reaction:1'), '👏');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].desired, '🔥');
  assert.equal(errors[0].confirmed, '👏');
});

test('state cache envelope accepts only the current user, schema, and seven-day freshness window', () => {
  assert.match(cache, /STATE_CACHE_VERSION/);
  assert.match(cache, /MAX_CACHE_AGE_MS/);
  assert.match(cache, /userId/);
  assert.match(cache, /savedAt/);
  assert.match(cache, /schemaVersion/);
  assert.match(cache, /7 \* 24 \* 60 \* 60 \* 1000/);
});

test('repository exposes a fast peek/hydrate path and hot persistence methods avoid full load', () => {
  assert.match(store, /peekState/);
  assert.match(store, /hydrateState/);
  assert.match(store, /async function setPositiveReaction/);
  const reaction = section(store, 'async function setPositiveReaction(', 'async function markProofInvalid(');
  assert.doesNotMatch(reaction, /return load\(/);
  const comment = section(store, 'async function addComment(', 'async function deleteComment(');
  assert.doesNotMatch(comment, /return load\(/);
  const deleteComment = section(store, 'async function deleteComment(', 'async function inviteFriend(');
  assert.doesNotMatch(deleteComment, /return load\(/);
});

test('app routes hot interactions through optimistic state rather than global runMutation', () => {
  assert.match(app, /createLatestIntentCoordinator/);
  assert.match(app, /reactionCoordinator/);
  const reaction = section(app, 'async function handleReaction(', 'async function handleCommentSubmit(');
  assert.doesNotMatch(reaction, /runMutation/);
  assert.match(reaction, /patchReactionDom/);
  const comment = section(app, 'async function handleCommentSubmit(', 'async function handleUndoCommentDelete(');
  assert.doesNotMatch(comment, /runMutation/);
  assert.match(comment, /applyOptimisticComment/);
});

test('warm startup reads user cache before authoritative load and sign-out clears it', () => {
  assert.match(app, /readStateCache\(session\.user\.id\)/);
  assert.match(app, /activeRepo\.hydrateState\(cachedState\)/);
  assert.match(app, /await activeRepo\.load/);
  assert.ok(app.indexOf('activeRepo.hydrateState(cachedState)') < app.indexOf('await activeRepo.load'));
  assert.match(app, /clearStateCache\(userId\)/);
});

test('cached startup stays read-only until an authoritative load succeeds', () => {
  assert.match(app, /authoritativeReady = false/);
  assert.match(app, /authoritativeReady = true/);
  assert.match(app, /networkBootLoading \|\| !authoritativeReady/);
  assert.match(app, /Refreshing your latest data/);
});

test('Friends list primes a fresh invite before the tap so native share keeps user activation', () => {
  assert.match(app, /prefetchedFriendInvite/);
  assert.match(app, /friendInvitePromise/);
  assert.match(app, /primeFriendInvite/);
  const openPeople = section(app, "app.querySelectorAll('[data-people-open]')", "app.querySelectorAll('[data-invite-from-people]')");
  assert.match(openPeople, /primeFriendInvite/);

  const share = section(app, "app.querySelectorAll('[data-invite-from-people]')", "app.querySelectorAll('[data-add-friend-from-people]')");
  assert.match(share, /sharePreparedInvite/);
  assert.doesNotMatch(share, /await handleCreateFriendInvite\(/);

  const preparedShare = section(app, 'async function sharePreparedInvite(', 'async function handleShareInvite()');
  assert.match(preparedShare, /navigator\.share\(payload\)/);
  const firstAwait = preparedShare.indexOf('await ');
  const shareCall = preparedShare.indexOf('navigator.share(payload)');
  assert.ok(shareCall >= 0 && firstAwait === shareCall - 'await '.length, 'navigator.share must be the first awaited operation');
});

test('optimistic reply success refreshes server ids without rebuilding the proof feed', () => {
  const submit = section(app, 'async function handleCommentSubmit(', 'async function handleUndoCommentDelete(');
  const replace = submit.indexOf('repo.replaceOptimisticComment(temp.id, saved)');
  const overlayRefresh = submit.indexOf('refreshCommentSheet()', replace);
  assert.ok(replace >= 0 && overlayRefresh > replace);
  assert.doesNotMatch(submit, /renderPreservingScroll\(\)/);
  const undo = section(app, 'async function handleUndoCommentDelete(', 'async function handleDeleteComment(');
  assert.doesNotMatch(undo, /fakeEvent/);
});

test('Friends list uses one action row and Invite friends goes straight to share flow', () => {
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  assert.match(people, /people-growth-actions/);
  assert.match(people, /data-invite-from-people/);
  assert.match(people, /data-add-friend-from-people/);
  assert.match(social, /\.people-growth-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
});

test('inline proof image loader reuses a cached signed URL before signing again', () => {
  assert.match(app, /proofThumbnailUrls\.get\(path\)/);
  const loader = section(app, 'async function loadProofThumbnail(', 'function bindProofThumbnails()');
  assert.match(loader, /const cached = proofThumbnailUrls\.get\(path\)/);
  assert.match(loader, /if \(cached\)/);
  assert.match(loader, /repo\.getProofUrl\(path\)/);
});

test('new performance modules are syntax-checked and shell cache advances to v27', () => {
  assert.match(pkg.scripts.check, /src\/optimistic\.js/);
  assert.match(pkg.scripts.check, /src\/state-cache\.js/);
  const version = Number(sw.match(/CACHE_VERSION = 'donezo-v(\d+)'/)?.[1]);
  assert.ok(version >= 27);
});
