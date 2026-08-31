import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/app.js';
let source = await readFile(path, 'utf8');

function replaceOnce(search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Missing marker: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`Ambiguous marker: ${label}`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceBetween(start, end, replacement, label) {
  const first = source.indexOf(start);
  if (first < 0) throw new Error(`Missing start marker: ${label}`);
  const last = source.indexOf(end, first + start.length);
  if (last < 0) throw new Error(`Missing end marker: ${label}`);
  source = `${source.slice(0, first)}${replacement}${source.slice(last)}`;
}

replaceOnce(
`let networkBootLoading = false;
let reconciliationTimer = null;
let commentRetryDraft = null;
let inviteShareBusy = false;
const optimisticPatches = new Map();`,
`let networkBootLoading = false;
let authoritativeReady = false;
let reconciliationTimer = null;
let commentRetryDraft = null;
let prefetchedFriendInvite = null;
let friendInvitePromise = null;
let friendInvitePreparing = false;
const optimisticPatches = new Map();`,
'performance state flags',
);

replaceOnce(
`async function runOptimisticMutation({ key, apply, rollback, persist, errorMessage = 'Could not save that change', onSuccess = null }) {
  if (!online) {`,
`async function runOptimisticMutation({ key, apply, rollback, persist, errorMessage = 'Could not save that change', onSuccess = null }) {
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return undefined;
  }
  if (!online) {`,
'optimistic readiness gate',
);

replaceOnce(
`async function refreshRepositoryData(activeRepo) {
  await activeRepo.load();
  if (!session || repo !== activeRepo) return;
  reapplyOptimisticPatches();`,
`async function refreshRepositoryData(activeRepo) {
  await activeRepo.load();
  if (!session || repo !== activeRepo) return;
  authoritativeReady = true;
  reapplyOptimisticPatches();`,
'refresh readiness',
);

replaceOnce(
`async function runMutation(action, successMessage, { preserveDraft = false } = {}) {
  if (busy || networkBootLoading) {
    if (networkBootLoading) notify('Finishing the latest sync…', 1800);
    return undefined;
  }`,
`async function runMutation(action, successMessage, { preserveDraft = false } = {}) {
  if (busy || networkBootLoading || !authoritativeReady) {
    if (networkBootLoading || !authoritativeReady) notify('Refreshing your latest data…', 2200);
    return undefined;
  }`,
'authoritative mutation gate',
);

replaceOnce(
`async function handleJoinCircle(event) {
  event.preventDefault();
  if (busy) return;`,
`async function handleJoinCircle(event) {
  event.preventDefault();
  if (session && (networkBootLoading || !authoritativeReady)) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (busy) return;`,
'join readiness gate',
);

replaceOnce(
`async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
  await refreshCoordinator?.waitForIdle();`,
`async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  await refreshCoordinator?.waitForIdle();`,
'proof readiness gate',
);

replaceOnce(
`async function handleReaction(checkInId, emoji) {
  if (!online) {`,
`async function handleReaction(checkInId, emoji) {
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!online) {`,
'reaction readiness gate',
);

replaceOnce(
`  const body = String(form.get('body') || '').trim();
  if (!checkInId || !body || !online) {`,
`  const body = String(form.get('body') || '').trim();
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!checkInId || !body || !online) {`,
'comment add readiness gate',
);

replaceOnce(
`    const saved = await repo.addComment(checkInId, body);
    repo.replaceOptimisticComment(temp.id, saved);
    optimisticPatches.delete(key);`,
`    const saved = await repo.addComment(checkInId, body);
    repo.replaceOptimisticComment(temp.id, saved);
    optimisticPatches.delete(key);
    renderPreservingScroll();`,
'comment server id render',
);

replaceOnce(
`async function handleUndoCommentDelete(comment) {
  if (!comment) return;
  commentRetryDraft = { checkInId: comment.checkInId, body: comment.body };
  const fakeEvent = { preventDefault() {}, currentTarget: { entries: undefined } };
  const restored = repo.applyOptimisticComment(comment.checkInId, comment.body, comment);`,
`async function handleUndoCommentDelete(comment) {
  if (!comment) return;
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  commentRetryDraft = { checkInId: comment.checkInId, body: comment.body };
  const restored = repo.applyOptimisticComment(comment.checkInId, comment.body, comment);`,
'comment undo cleanup',
);
replaceOnce(
`  }
  void fakeEvent;
}

async function handleDeleteComment(commentId) {`,
`  }
}

async function handleDeleteComment(commentId) {`,
'comment undo dead event removal',
);
replaceOnce(
`async function handleDeleteComment(commentId) {
  const comment = (getState().comments || []).find((item) => item.id === commentId);
  if (!comment || !online) return;`,
`async function handleDeleteComment(commentId) {
  const comment = (getState().comments || []).find((item) => item.id === commentId);
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!comment || !online) return;`,
'comment delete readiness gate',
);

replaceOnce(
`  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; render(); }; });`,
`  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; void primeFriendInvite(); render(); }; });`,
'friend invite prefetch binding',
);

replaceBetween(
`async function handleCreateFriendInvite() {`,
`function clearPendingInvite() {`,
`function inviteCodeFrom(value) {
  return typeof value === 'string' ? value : value?.code || value?.inviteCode || '';
}

function inviteUrlFrom(value, code) {
  return (typeof value === 'object' && value?.url) || buildInviteLink(window.location.href, code);
}

function primeFriendInvite() {
  if (typeof repo?.createFriendInvite !== 'function' || !session || !online || networkBootLoading || !authoritativeReady) return Promise.resolve(null);
  if (prefetchedFriendInvite) return Promise.resolve(prefetchedFriendInvite);
  if (friendInvitePromise) return friendInvitePromise;
  friendInvitePreparing = true;
  friendInvitePromise = repo.createFriendInvite()
    .then((invite) => {
      prefetchedFriendInvite = invite;
      return invite;
    })
    .catch((error) => {
      notify(readableError(error), 3600);
      return null;
    })
    .finally(() => {
      friendInvitePreparing = false;
      friendInvitePromise = null;
      if (peopleSheetOpen) renderPreservingScroll();
    });
  return friendInvitePromise;
}

async function sharePreparedInvite(invite) {
  const code = inviteCodeFrom(invite);
  if (!validateInviteCode(code).valid) {
    notify('Invite code is not ready yet. Try again in a sec.', 3200);
    return false;
  }
  const url = inviteUrlFrom(invite, code);
  const payload = {
    title: 'Join me on Donezo',
    text: 'Join me on Donezo. We’re trying to actually lock in.',
    url,
  };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(payload);
      if (invite === prefetchedFriendInvite) {
        prefetchedFriendInvite = null;
        if (peopleSheetOpen) void primeFriendInvite();
      }
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify('Invite link copied');
    if (invite === prefetchedFriendInvite) {
      prefetchedFriendInvite = null;
      if (peopleSheetOpen) void primeFriendInvite();
    }
    return true;
  } catch {
    notify(url, 6000);
    return false;
  }
}

async function handleShareInvite() {
  const directFriendFlow = typeof repo?.createFriendInvite === 'function';
  if (directFriendFlow) {
    const invite = prefetchedFriendInvite || createdFriendInvite;
    if (!invite) {
      if (networkBootLoading || !authoritativeReady) notify('Refreshing your latest data…', 2200);
      else if (friendInvitePreparing) notify('Preparing a fresh invite…', 1800);
      else {
        notify('Preparing a fresh invite…', 1800);
        void primeFriendInvite();
      }
      return;
    }
    await sharePreparedInvite(invite);
    return;
  }
  const code = activeInviteCode();
  await sharePreparedInvite({ code, url: activeInviteUrl() || buildInviteLink(window.location.href, code) });
}

`,
'direct prepared share flow',
);

replaceOnce(
`async function handleSignOut() {
  const userId = session?.user?.id;
  bootGeneration += 1;`,
`async function handleSignOut() {
  const userId = session?.user?.id;
  bootGeneration += 1;
  authoritativeReady = false;
  prefetchedFriendInvite = null;
  friendInvitePromise = null;
  friendInvitePreparing = false;`,
'signout readiness reset',
);

replaceOnce(
`  online = navigator.onLine !== false;
  networkBootLoading = false;
  if (!session) {`,
`  online = navigator.onLine !== false;
  networkBootLoading = false;
  authoritativeReady = false;
  prefetchedFriendInvite = null;
  friendInvitePromise = null;
  friendInvitePreparing = false;
  if (!session) {`,
'boot readiness reset',
);
replaceOnce(
`    networkBootLoading = false;
    reapplyOptimisticPatches();`,
`    networkBootLoading = false;
    authoritativeReady = true;
    reapplyOptimisticPatches();`,
'boot authoritative success',
);

// Make the Friends action self-explanatory while the prefetch is still in flight.
source = source.replace(
  `<button class="btn" type="button" data-invite-from-people>Invite friends</button>`,
  `<button class="btn" type="button" data-invite-from-people ${friendInvitePreparing ? 'disabled aria-busy="true"' : ''}>${friendInvitePreparing ? 'Preparing…' : 'Invite friends'}</button>`,
);

await writeFile(path, source);
