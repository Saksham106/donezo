// Home: the friends feed (photo, text and comeback check-ins) with
// reactions, replies, and a per-post overflow menu.
import { createLatestIntentCoordinator } from '../optimistic.js';
import { proofRejectionThreshold } from '../domain.js';
import { feedActivities, isComeback, myHabits, unseenUpdatesCount } from '../today-domain.js';
import { activityList, app, friendList, getState, me, member, optimisticPatches, proofThumbnailUrls, ui } from './state.js';
import { avatar, esc, formatAgo, formatWhen, haptic, icon, notify, readableError, yieldToPaint } from './util.js';
import { render, renderPreservingScroll } from './render.js';
import { dataNotReady, runOptimisticMutation, scheduleReconciliation } from './sync.js';
import { handleRedoProof, openCheckIn } from './checkin.js';
import { openFriendProfile, openInviteSheet } from './people.js';
import { openHabitEditor } from './habits.js';

const POSITIVE_REACTIONS = ['👏', '🔥', '💪', '😂'];

function displayName(userId) {
  if (userId === getState()?.currentUserId) return me()?.name || 'You';
  return member(userId)?.name || 'Friend';
}

function visibleReactions(activity) {
  const mine = (activity.userReactions || []).slice(-1);
  const counts = { ...(activity.reactionCounts || {}) };
  mine.forEach((emoji) => { counts[emoji] = Math.max(1, Number(counts[emoji] || 0)); });
  return { mine, counts };
}

function reactionsRow(activity) {
  const { mine, counts } = visibleReactions(activity);
  const commentCount = (getState().comments || []).filter((comment) => comment.checkInId === activity.checkInId).length;
  const pills = POSITIVE_REACTIONS.filter((emoji) => Number(counts[emoji] || 0) > 0).map((emoji) => {
    const active = mine.includes(emoji);
    return `<button type="button" class="dz-reaction ${active ? 'mine' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-pressed="${active}" aria-label="React ${emoji}">${emoji} <span>${counts[emoji]}</span></button>`;
  }).join('');
  const picker = ui.reactionPickerCheckInId === activity.checkInId
    ? `<div class="dz-reaction-picker" role="group" aria-label="Pick a reaction">${POSITIVE_REACTIONS.map((emoji) => `<button type="button" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" class="${mine.includes(emoji) ? 'mine' : ''}">${emoji}</button>`).join('')}</div>`
    : '';
  return `<div class="dz-reactions" data-reactions-for="${activity.checkInId}">${pills}<button type="button" class="dz-chip-btn" data-reaction-picker="${activity.checkInId}" aria-label="Add reaction" aria-expanded="${ui.reactionPickerCheckInId === activity.checkInId}">${icon('smile', 17)}</button><button type="button" class="dz-chip-btn label" data-comment-open="${activity.checkInId}">${icon('reply', 15)}${commentCount || 'Reply'}</button>${picker}</div>`;
}

function latestReply(checkInId) {
  const comments = (getState()?.comments || [])
    .filter((comment) => comment.checkInId === checkInId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latest = comments.at(-1);
  if (!latest) return '';
  const author = latest.authorId === getState()?.currentUserId ? { ...me(), name: 'You' } : member(latest.authorId);
  return `<button type="button" class="dz-reply-preview" data-comment-open="${checkInId}">${avatar(author, 20)}<span><b>${esc(author?.name || 'Friend')}</b> ${esc(latest.body)}</span></button>`;
}

export function feedPost(activity) {
  const mine = activity.userId === getState()?.currentUserId;
  const person = mine ? me() : member(activity.userId);
  const note = activity.message === 'Done. Proof beats promises.' ? '' : activity.message;
  const comeback = isComeback(activity);
  const tag = activity.invalid
    ? '<span class="dz-pill danger">Rejected</span>'
    : comeback ? '<span class="dz-pill comeback">Comeback</span>' : '';
  const photo = activity.proofPath
    ? `<div class="dz-photo" data-proof-image="${esc(activity.proofPath)}" aria-label="${esc(activity.habitTitle)} proof"><span class="dz-photo-placeholder">Loading proof…</span></div>`
    : '';
  const social = activity.checkInId ? `${reactionsRow(activity)}${latestReply(activity.checkInId)}` : '';
  return `<article class="dz-post ${activity.invalid ? 'invalid' : ''}" data-check-in="${esc(activity.checkInId || activity.id)}"><button type="button" class="dz-post-avatar" data-friend-profile="${activity.userId}" aria-label="Open ${esc(person?.name || 'friend')} profile">${avatar(person, 40)}</button><div class="dz-post-body"><div class="dz-post-head"><button type="button" class="dz-post-name" data-friend-profile="${activity.userId}">${esc(displayName(activity.userId))}</button><time title="${esc(formatWhen(activity.when))}">${esc(formatAgo(activity.when))}</time>${activity.checkInId ? `<button type="button" class="dz-icon-btn small" data-post-menu="${activity.checkInId}" aria-label="More options">${icon('more', 18)}</button>` : ''}</div><div class="dz-post-habit"><span aria-hidden="true">${esc(activity.emoji || '✓')}</span><strong>${esc(activity.habitTitle || 'Habit')}</strong>${activity.invalid ? '' : `<span class="dz-check" aria-label="Done">${icon('check', 10, 3.2)}</span>`}${tag}</div>${note ? `<p class="dz-post-note">${esc(note)}</p>` : ''}${photo}${social}${activity.invalid ? '<p class="dz-fine">Rejected by friends. Doesn’t count toward streaks or Standings.</p>' : ''}</div></article>`;
}

function activationSteps() {
  const state = getState();
  const steps = [
    { done: myHabits(state).length > 0, label: 'Add a habit', action: 'data-open-habit' },
    { done: friendList(state).some((person) => person.id !== state.currentUserId), label: 'Invite a friend', action: 'data-invite-open' },
    { done: state.checkIns.some((item) => item.userId === state.currentUserId && !item.invalid), label: 'Post your first check-in', action: 'data-checkin-action' },
  ];
  return `<section class="dz-empty"><h2>Your feed starts here</h2><p>Check-ins from you and your friends show up on Home.</p><ol class="dz-steps">${steps.map((step) => `<li class="${step.done ? 'done' : ''}"><span class="dz-step-mark">${step.done ? icon('check', 14, 3) : ''}</span><span>${esc(step.label)}</span>${step.done ? '' : `<button type="button" class="dz-link" ${step.action}>Go</button>`}</li>`).join('')}</ol></section>`;
}

export function homeScreen() {
  const state = getState();
  const unread = unseenUpdatesCount(state, activityList(state));
  const feed = feedActivities(activityList(state));
  const visible = feed.slice(0, ui.feedLimit);
  const posts = visible.map(feedPost).join('');
  const more = feed.length > visible.length ? '<button class="dz-btn secondary full dz-load-more" type="button" data-load-more>Load older check-ins</button>' : '';
  return `<header class="dz-header home"><h1 class="dz-wordmark">donezo</h1><button type="button" class="dz-icon-btn bell" data-updates-open aria-label="${unread ? `Updates, ${unread} new` : 'Updates'}">${icon('bell', 20)}${unread ? '<span class="dz-dot" aria-hidden="true"></span>' : ''}</button></header><div class="dz-pull" data-pull-indicator aria-hidden="true">${icon('refresh', 18)}</div><div class="dz-feed">${posts || activationSteps()}${more}</div>`;
}

// --- Sheets ---------------------------------------------------------------

export function postMenuSheet() {
  if (!ui.postMenuCheckInId) return '';
  const activity = activityList(getState()).find((item) => item.checkInId === ui.postMenuCheckInId);
  if (!activity) return '';
  const mine = activity.userId === getState().currentUserId;
  const threshold = proofRejectionThreshold(activity.audienceSize);
  const rejectionLabel = `${activity.downvotes || 0}${Number.isFinite(threshold) ? `/${threshold}` : ''}`;
  const options = [];
  if (!mine && activity.proofPath) options.push(`<button type="button" class="dz-menu-row danger" data-request-reject="${activity.checkInId}">👎 ${activity.userDownvoted ? 'Remove my rejection' : 'Reject proof'}<small>${esc(rejectionLabel)}</small></button>`);
  if (mine && activity.proofPath) options.push(`<div class="dz-menu-row static">👎 Rejections<small>${esc(rejectionLabel)}</small></div>`);
  if (mine && activity.invalid) options.push(`<button type="button" class="dz-menu-row" data-redo-checkin="${activity.checkInId}">${icon('camera', 18)} Retake proof</button>`);
  options.push(`<button type="button" class="dz-menu-row" data-comment-open="${activity.checkInId}">${icon('reply', 18)} Replies</button>`);
  if (!mine) options.push(`<button type="button" class="dz-menu-row" data-friend-profile="${activity.userId}">${icon('user', 18)} View ${esc(displayName(activity.userId))}</button>`);
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet dz-menu" role="dialog" aria-modal="true" aria-label="Post options" data-sheet><div class="sheet-handle"></div>${options.join('')}<button type="button" class="dz-menu-row muted" data-close-post-menu>Cancel</button></section></div>`;
}

export function proofRejectSheet() {
  if (!ui.proofRejectCheckInId) return '';
  const activity = activityList(getState()).find((item) => item.checkInId === ui.proofRejectCheckInId);
  return `<div class="sheet-backdrop proof-reject-layer"><section class="sheet compact-sheet proof-reject-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm proof rejection" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PROOF CHECK</p><h2>Reject this proof?</h2></div><button class="icon-btn" type="button" data-cancel-reject aria-label="Cancel">×</button></div><p class="sheet-copy">Only reject it if the photo genuinely does not prove ${esc(activity?.habitTitle || 'the habit')}. Enough rejections remove the check-in from streaks and Standings.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-reject>Keep proof</button><button class="btn danger-soft" type="button" data-confirm-reject="${ui.proofRejectCheckInId}">Reject proof</button></div></section></div>`;
}

export function commentSheet() {
  if (!ui.commentCheckInId) return '';
  const state = getState();
  const activity = activityList(state).find((item) => item.checkInId === ui.commentCheckInId);
  const comments = (state.comments || []).filter((item) => item.checkInId === ui.commentCheckInId);
  const rows = comments.map((comment) => {
    const author = comment.authorId === state.currentUserId ? me() : member(comment.authorId);
    return `<article class="comment-row"><button class="comment-profile" type="button" data-friend-profile="${comment.authorId}" aria-label="Open ${esc(author?.name || 'friend')} profile">${avatar(author, 32)}<span><strong>${comment.authorId === state.currentUserId ? 'You' : esc(author?.name || 'Friend')}</strong><small>${esc(formatWhen(comment.createdAt))}</small></span></button><p>${esc(comment.body)}</p>${comment.authorId === state.currentUserId ? `<button class="comment-delete" type="button" data-delete-comment="${comment.id}" aria-label="Delete reply">×</button>` : ''}</article>`;
  }).join('');
  const draft = ui.commentRetryDraft?.checkInId === ui.commentCheckInId ? esc(ui.commentRetryDraft.body) : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet comment-sheet" role="dialog" aria-modal="true" aria-label="Replies" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REPLIES</p><h2>${esc(activity?.emoji || '✓')} ${esc(activity?.habitTitle || 'Check-in')}</h2></div><button class="icon-btn" type="button" data-close-comments aria-label="Close">×</button></div><div class="comment-list">${rows || '<div class="empty compact-empty"><b>No replies yet.</b><p>Keep it short. This is hype, not group chat.</p></div>'}</div><form id="comment-form" class="comment-form"><input name="body" maxlength="180" required autocomplete="off" placeholder="Say something useful…" value="${draft}"><button class="btn primary" ${ui.busy ? 'disabled' : ''}>Send</button></form></section></div>`;
}

// --- Actions --------------------------------------------------------------

export function closeCommentSheet() {
  ui.commentCheckInId = null;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
}

function refreshCommentSheet() {
  if (!ui.commentCheckInId) return;
  const current = app.querySelector('.comment-sheet')?.closest('.sheet-backdrop');
  const container = document.createElement('div');
  container.innerHTML = commentSheet();
  const next = container.firstElementChild;
  if (!next) return;
  if (current) current.replaceWith(next);
  else app.querySelector('.app-shell')?.append(next);
  bindCommentSheet(next);
}

export function openCommentSheet(checkInId) {
  if (!checkInId) return;
  ui.postMenuCheckInId = null;
  ui.commentCheckInId = checkInId;
  render();
}

function bindCommentSheet(root) {
  root.querySelectorAll('[data-close-comments]').forEach((element) => { element.onclick = closeCommentSheet; });
  root.querySelector('#comment-form')?.addEventListener('submit', handleCommentSubmit);
  root.querySelectorAll('[data-delete-comment]').forEach((element) => { element.onclick = () => handleDeleteComment(element.dataset.deleteComment); });
  root.querySelectorAll('[data-friend-profile]').forEach((element) => { element.onclick = () => openFriendProfile(element.dataset.friendProfile); });
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  const checkInId = ui.commentCheckInId;
  const body = String(new FormData(event.currentTarget).get('body') || '').trim();
  if (dataNotReady()) return;
  if (!checkInId || !body || !ui.online) {
    if (!ui.online) notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  const key = `comment:add:${checkInId}`;
  if (optimisticPatches.has(key)) return;
  const temp = ui.repo.applyOptimisticComment(checkInId, body);
  optimisticPatches.set(key, () => ui.repo.applyOptimisticComment(checkInId, body, temp));
  ui.commentRetryDraft = null;
  refreshCommentSheet();
  await yieldToPaint();
  try {
    const saved = await ui.repo.addComment(checkInId, body);
    ui.repo.replaceOptimisticComment(temp.id, saved);
    optimisticPatches.delete(key);
    refreshCommentSheet();
    scheduleReconciliation();
    notify('Reply sent');
  } catch (error) {
    optimisticPatches.delete(key);
    ui.repo.removeOptimisticComment(temp.id);
    ui.commentRetryDraft = { checkInId, body };
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleUndoCommentDelete(comment) {
  if (!comment || dataNotReady()) return;
  ui.commentRetryDraft = { checkInId: comment.checkInId, body: comment.body };
  const restored = ui.repo.applyOptimisticComment(comment.checkInId, comment.body, comment);
  try {
    const saved = await ui.repo.addComment(comment.checkInId, comment.body);
    ui.repo.replaceOptimisticComment(restored.id, saved);
    ui.commentRetryDraft = null;
    scheduleReconciliation();
    refreshCommentSheet();
    notify('Reply restored');
  } catch (error) {
    ui.repo.removeOptimisticComment(restored.id);
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleDeleteComment(commentId) {
  const comment = (getState().comments || []).find((item) => item.id === commentId);
  if (dataNotReady() || !comment || !ui.online) return;
  const key = `comment:delete:${commentId}`;
  if (optimisticPatches.has(key)) return;
  const removed = ui.repo.removeOptimisticComment(commentId);
  optimisticPatches.set(key, () => ui.repo.removeOptimisticComment(commentId));
  refreshCommentSheet();
  await yieldToPaint();
  try {
    await ui.repo.deleteComment(commentId);
    optimisticPatches.delete(key);
    scheduleReconciliation();
    notify('Reply deleted', 5000, { action: { label: 'Undo', onClick: () => handleUndoCommentDelete(comment) } });
  } catch (error) {
    optimisticPatches.delete(key);
    if (removed) ui.repo.applyOptimisticComment(removed.checkInId, removed.body, removed);
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleDownvote(checkInId) {
  const checkIn = getState()?.checkIns.find((item) => item.id === checkInId);
  if (!checkIn) return;
  const previous = Boolean(checkIn.userDownvoted);
  const desired = !previous;
  const result = await runOptimisticMutation({
    key: `downvote:${checkInId}`,
    apply: () => ui.repo.applyProofDownvote(checkInId, desired),
    rollback: () => ui.repo.applyProofDownvote(checkInId, previous),
    persist: () => ui.repo.setProofDownvote(checkInId, desired),
    errorMessage: 'Could not update proof vote',
  });
  if (result !== undefined) haptic(18);
}

/** Swap just one post's reaction row so a tap never jumps the feed. */
function patchReactions(checkInId) {
  const activity = activityList(getState()).find((item) => item.checkInId === checkInId);
  const current = app.querySelector(`[data-reactions-for="${CSS.escape(checkInId)}"]`);
  if (!activity || !current) return;
  const container = document.createElement('div');
  container.innerHTML = reactionsRow(activity);
  const next = container.firstElementChild;
  current.replaceWith(next);
  bindReactions(next);
}

const reactionCoordinator = createLatestIntentCoordinator({
  persist: async (key, desired) => ui.repo.setPositiveReaction(key.slice('reaction:'.length), desired),
  onConfirmed: () => scheduleReconciliation(),
  onError: ({ key, confirmed, error }) => {
    const checkInId = key.slice('reaction:'.length);
    optimisticPatches.delete(key);
    try { ui.repo.applyPositiveReaction(checkInId, confirmed); } catch { /* The proof may have disappeared. */ }
    patchReactions(checkInId);
    notify(readableError(error), 3600);
  },
});

function handleReaction(checkInId, emoji) {
  if (dataNotReady()) return;
  if (!ui.online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  const activity = activityList(getState()).find((item) => item.checkInId === checkInId);
  if (!activity) return;
  const current = (activity.userReactions || []).slice(-1)[0] || null;
  const desired = current === emoji ? null : emoji;
  const key = `reaction:${checkInId}`;
  ui.reactionPickerCheckInId = null;
  ui.repo.applyPositiveReaction(checkInId, desired);
  optimisticPatches.set(key, () => ui.repo.applyPositiveReaction(checkInId, reactionCoordinator.desired(key)));
  patchReactions(checkInId);
  haptic(18);
  reactionCoordinator.queue(key, desired, { confirmed: reactionCoordinator.confirmed(key) ?? current });
  void reactionCoordinator.whenIdle(key).then(() => {
    if (!reactionCoordinator.isPending(key)) {
      optimisticPatches.delete(key);
      scheduleReconciliation();
    }
  });
}

function bindReactions(root) {
  root.querySelectorAll('[data-reaction]').forEach((element) => { element.onclick = () => handleReaction(element.dataset.reaction, element.dataset.reactionEmoji); });
  root.querySelectorAll('[data-reaction-picker]').forEach((element) => { element.onclick = () => {
    const checkInId = element.dataset.reactionPicker;
    const previous = ui.reactionPickerCheckInId;
    ui.reactionPickerCheckInId = previous === checkInId ? null : checkInId;
    if (previous && previous !== checkInId) patchReactions(previous);
    patchReactions(checkInId);
  }; });
  root.querySelectorAll('[data-comment-open]').forEach((element) => { element.onclick = () => openCommentSheet(element.dataset.commentOpen); });
}

// --- Proof images -----------------------------------------------------------

async function loadProofThumbnail(element) {
  const path = element.dataset.proofImage;
  if (!path || !element.isConnected) return;
  const fallback = () => { if (element.isConnected) element.innerHTML = '<span class="dz-photo-placeholder">Photo unavailable</span>'; };
  try {
    let url = proofThumbnailUrls.get(path);
    if (!url) {
      url = await ui.repo.getProofUrl(path);
      // Signed URLs expire after five minutes; forget them a little before that.
      proofThumbnailUrls.set(path, url);
      setTimeout(() => { if (proofThumbnailUrls.get(path) === url) proofThumbnailUrls.delete(path); }, 240_000);
    }
    if (!element.isConnected || element.dataset.proofImage !== path) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { proofThumbnailUrls.delete(path); fallback(); });
    element.replaceChildren(image);
  } catch {
    fallback();
  }
}

export function bindProofThumbnails(root = app) {
  const thumbnails = [...root.querySelectorAll('[data-proof-image]')];
  if (!thumbnails.length) return;
  if (!('IntersectionObserver' in window)) {
    thumbnails.forEach(loadProofThumbnail);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      void loadProofThumbnail(entry.target);
    });
  }, { rootMargin: '240px 0px' });
  thumbnails.forEach((element) => observer.observe(element));
}

export function bindHome(root) {
  bindReactions(root);
  root.querySelectorAll('[data-post-menu]').forEach((element) => { element.onclick = () => { ui.postMenuCheckInId = element.dataset.postMenu; render(); }; });
  root.querySelectorAll('[data-close-post-menu]').forEach((element) => { element.onclick = () => { ui.postMenuCheckInId = null; render(); }; });
  root.querySelectorAll('[data-request-reject]').forEach((element) => { element.onclick = () => {
    const checkInId = element.dataset.requestReject;
    const activity = activityList(getState()).find((item) => item.checkInId === checkInId);
    ui.postMenuCheckInId = null;
    if (activity?.userDownvoted) { render(); void handleDownvote(checkInId); return; }
    ui.proofRejectCheckInId = checkInId;
    render();
  }; });
  root.querySelector('[data-confirm-reject]')?.addEventListener('click', () => {
    const id = ui.proofRejectCheckInId;
    ui.proofRejectCheckInId = null;
    void handleDownvote(id);
  });
  root.querySelectorAll('[data-cancel-reject]').forEach((element) => { element.onclick = () => { ui.proofRejectCheckInId = null; render(); }; });
  root.querySelectorAll('[data-redo-checkin]').forEach((element) => { element.onclick = () => { ui.postMenuCheckInId = null; handleRedoProof(element.dataset.redoCheckin); }; });
  root.querySelectorAll('[data-load-more]').forEach((element) => { element.onclick = () => { ui.feedLimit += 12; renderPreservingScroll(); }; });
  root.querySelectorAll('[data-invite-open]').forEach((element) => { element.onclick = openInviteSheet; });
  root.querySelectorAll('[data-empty-checkin]').forEach((element) => { element.onclick = openCheckIn; });
  root.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => openHabitEditor(); });
  const commentRoot = root.querySelector('.comment-sheet');
  if (commentRoot) bindCommentSheet(commentRoot.closest('.sheet-backdrop'));
  bindProofThumbnails(root);
}
