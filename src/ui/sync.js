// Mutations, optimistic patches, background refresh and the offline cache.
import { createRefreshCoordinator } from '../refresh.js';
import { writeStateCache } from '../state-cache.js';
import { app, optimisticPatches, screenScroll, ui } from './state.js';
import { notify, readableError, yieldToPaint } from './util.js';
import { renderPreservingScroll } from './render.js';

export function reapplyOptimisticPatches() {
  for (const apply of optimisticPatches.values()) {
    try { apply(); } catch { /* Authoritative refresh may make a stale patch irrelevant. */ }
  }
}

export function scheduleReconciliation(delay = 650) {
  clearTimeout(ui.reconciliationTimer);
  ui.reconciliationTimer = setTimeout(() => { void ui.refreshCoordinator?.request('optimistic'); }, delay);
}

export function scheduleStateCacheWrite(activeRepo = ui.repo) {
  const userId = ui.session?.user?.id;
  if (!userId || !activeRepo) return;
  const write = () => {
    if (ui.repo !== activeRepo || ui.session?.user?.id !== userId) return;
    void writeStateCache(userId, activeRepo.getState());
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 1500 });
  else setTimeout(write, 0);
}

export function dataNotReady() {
  if (!ui.networkBootLoading && ui.authoritativeReady) return false;
  notify('Refreshing your latest data…', 2200);
  return true;
}

export async function runOptimisticMutation({ key, apply, rollback, persist, errorMessage = 'Could not save that change', onSuccess = null }) {
  if (dataNotReady()) return undefined;
  if (!ui.online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return undefined;
  }
  if (optimisticPatches.has(key)) return undefined;
  optimisticPatches.set(key, apply);
  apply();
  renderPreservingScroll();
  await yieldToPaint();
  try {
    const result = await persist();
    optimisticPatches.delete(key);
    if (typeof onSuccess === 'function') onSuccess(result);
    scheduleReconciliation();
    return result;
  } catch (error) {
    optimisticPatches.delete(key);
    rollback();
    renderPreservingScroll();
    notify(readableError(error) || errorMessage, 3600);
    return undefined;
  }
}

export async function runMutation(action, successMessage, { preserveDraft = false } = {}) {
  if (ui.busy || ui.networkBootLoading || !ui.authoritativeReady) {
    if (ui.networkBootLoading || !ui.authoritativeReady) notify('Refreshing your latest data…', 2200);
    return undefined;
  }
  if (!ui.online) {
    ui.mutationStatus = 'failed';
    ui.retryMutation = () => runMutation(action, successMessage, { preserveDraft });
    notify('You are offline. Nothing was saved yet.', 3600);
    if (!preserveDraft) renderPreservingScroll();
    return undefined;
  }
  await ui.refreshCoordinator?.waitForIdle();
  if (ui.busy) return undefined;
  clearTimeout(runMutation.statusTimer);
  ui.busy = true;
  ui.mutationStatus = 'saving';
  ui.retryMutation = null;
  if (!preserveDraft) renderPreservingScroll();
  try {
    const result = await action();
    ui.mutationStatus = 'saved';
    if (successMessage) notify(successMessage);
    clearTimeout(runMutation.statusTimer);
    runMutation.statusTimer = setTimeout(() => { ui.mutationStatus = 'idle'; renderPreservingScroll(); }, 1400);
    return result;
  } catch (error) {
    ui.mutationStatus = 'failed';
    ui.retryMutation = null;
    notify(readableError(error), 3600);
    return undefined;
  } finally {
    ui.busy = false;
    if (!preserveDraft) renderPreservingScroll();
  }
}

/** True while something the user is typing or reviewing would be lost by a re-render. */
export function hasUnsavedDraft() {
  return ui.habitSheetOpen
    || ui.settingsSheetOpen
    || Boolean(ui.nudgeComposerUserId)
    || Boolean(ui.recoveryHabitId)
    || ui.challengeSheetOpen
    || Boolean(ui.commentCheckInId)
    || ui.batonSheetOpen
    || Boolean(ui.dualProof)
    || Boolean(ui.proofCrop)
    || Boolean(ui.proofReview)
    || ui.peopleSheetOpen
    || ui.addFriendSheetOpen
    || Boolean(ui.friendsQuery)
    || document.activeElement?.matches?.('input, textarea, select') === true;
}

function shouldDeferFeedRender() {
  const scrollTop = app.querySelector('#content-scroll')?.scrollTop ?? screenScroll.home ?? 0;
  return ui.tab === 'home' && scrollTop > 4;
}

async function refreshRepositoryData(activeRepo) {
  await activeRepo.load();
  if (!ui.session || ui.repo !== activeRepo) return;
  ui.authoritativeReady = true;
  reapplyOptimisticPatches();
  ui.lastRefreshAt = new Date().toISOString();
  if (!hasUnsavedDraft() && !shouldDeferFeedRender()) renderPreservingScroll();
  scheduleStateCacheWrite(activeRepo);
}

export function stopRefreshCoordinator() {
  ui.refreshCoordinator?.stop();
  ui.refreshCoordinator = null;
  ui.manualRefreshLoading = false;
}

export function startRefreshCoordinator(activeRepo) {
  stopRefreshCoordinator();
  ui.online = navigator.onLine !== false;
  ui.refreshCoordinator = createRefreshCoordinator({
    refresh: () => refreshRepositoryData(activeRepo),
    isVisible: () => document.visibilityState === 'visible',
    isOnline: () => navigator.onLine !== false,
    isBusy: () => ui.busy,
    onNetworkChange: (value) => {
      if (ui.repo !== activeRepo || !ui.session) return;
      ui.online = value;
      if (!hasUnsavedDraft() && !shouldDeferFeedRender()) renderPreservingScroll();
    },
    documentTarget: document,
    windowTarget: window,
    intervalMs: 30_000,
  });
  ui.refreshCoordinator.start();
}

function syncManualRefreshButtons() {
  app.querySelectorAll('[data-manual-refresh]').forEach((button) => {
    button.classList.toggle('loading', ui.manualRefreshLoading);
    button.disabled = ui.manualRefreshLoading;
  });
}

export async function handleManualRefresh() {
  const coordinator = ui.refreshCoordinator;
  if (!coordinator || ui.manualRefreshLoading) return;
  ui.manualRefreshLoading = true;
  syncManualRefreshButtons();
  const result = await coordinator.request('manual');
  if (coordinator !== ui.refreshCoordinator) return;
  ui.manualRefreshLoading = false;
  syncManualRefreshButtons();
  if (result.status === 'refreshed') notify('Synced just now');
  else if (result.status === 'failed') notify('Refresh flopped. Keeping your last good data.', 3600);
  else if (result.reason === 'offline') notify('Still offline. Showing your last sync.', 3200);
  else if (result.reason === 'busy') notify('Finish that action first, then refresh.', 2800);
}

export async function handleApplyPwaUpdate() {
  if (hasUnsavedDraft()) {
    notify('Finish or close your draft before updating.');
    return;
  }
  ui.pwaApplying = true;
  renderPreservingScroll();
  const applied = window.DonezoPWA?.applyUpdate?.();
  if (!applied) {
    ui.pwaApplying = false;
    ui.pwaUpdateAvailable = Boolean(window.DonezoPWA?.updateAvailable);
    notify('Update could not start. Try again in a moment.');
    renderPreservingScroll();
  }
}
