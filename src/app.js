// Donezo entry: boot, auth session, and deep links. Screens live in ./ui/.
import { createSupabaseRepository } from './store.js';
import { readStateCache } from './state-cache.js';
import { getNotificationCapability, syncPushSubscription } from './notifications.js';
import { activityList, app, initialNavigation, optimisticPatches, setActiveTab, ui } from './ui/state.js';
import { esc, notify, readableError } from './ui/util.js';
import { render, renderPreservingScroll } from './ui/render.js';
import { reapplyOptimisticPatches, scheduleStateCacheWrite, startRefreshCoordinator, stopRefreshCoordinator } from './ui/sync.js';
import { handleSignOut, supabase } from './ui/auth.js';
import { applyTheme, currentThemeChoice } from './ui/settings.js';
import { bindNativeProofInputs, handleHabit, resetProofFlow } from './ui/checkin.js';
import { openCommentSheet } from './ui/home.js';
import { offerPendingInvite } from './ui/people.js';
import { openUpdatesCenter } from './ui/social.js';

// The redesign stylesheet loads after the base styles so its tokens win.
if (!document.querySelector('link[href="/redesign.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/redesign.css';
  document.head.append(link);
}

applyTheme(currentThemeChoice());

function requestPortraitLock() {
  if (!window.matchMedia('(display-mode: standalone)').matches) return;
  const lockRequest = screen.orientation?.lock?.('portrait');
  lockRequest?.catch?.(() => {});
}

requestPortraitLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestPortraitLock();
});

function loadingScreen() {
  return '<div class="dz-auth loading"><header class="dz-wordmark">donezo</header><p>Loading your people…</p></div>';
}

/** Push-notification deep links: open the post, the habit, or Updates. */
async function applyInitialNavigation() {
  if (ui.initialNavigationHandled) return;
  ui.initialNavigationHandled = true;
  if (initialNavigation.nudgesOpen) {
    await openUpdatesCenter();
    return;
  }
  if (initialNavigation.habitId && initialNavigation.tab === 'checkin') {
    await handleHabit(initialNavigation.habitId);
    return;
  }
  if (!initialNavigation.checkInId) return;
  const activity = activityList().find((item) => item.checkInId === initialNavigation.checkInId);
  if (!activity) return;
  setActiveTab('home');
  render();
  requestAnimationFrame(() => {
    const target = app.querySelector(`[data-check-in="${CSS.escape(initialNavigation.checkInId)}"]`);
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.classList.add('deep-link-target');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    } else {
      openCommentSheet(initialNavigation.checkInId);
    }
  });
}

async function boot(nextSession) {
  const generation = ++ui.bootGeneration;
  stopRefreshCoordinator();
  resetProofFlow();
  optimisticPatches.clear();
  clearTimeout(ui.reconciliationTimer);
  ui.session = nextSession;
  ui.online = navigator.onLine !== false;
  ui.networkBootLoading = false;
  ui.authoritativeReady = false;
  ui.prefetchedFriendInvite = null;
  ui.friendInvitePromise = null;
  ui.friendInvitePreparing = false;
  if (!ui.session) {
    ui.repo = null;
    ui.lastRefreshAt = null;
    render();
    return;
  }
  const stale = () => generation !== ui.bootGeneration || nextSession?.user?.id !== ui.session?.user?.id;
  app.innerHTML = loadingScreen();
  const activeRepo = createSupabaseRepository(supabase, ui.session.user);
  ui.repo = activeRepo;
  let cachedRendered = false;
  const cachedState = await readStateCache(ui.session.user.id);
  if (stale()) return;
  if (cachedState) {
    try {
      activeRepo.hydrateState(cachedState);
      cachedRendered = true;
      render();
    } catch {
      cachedRendered = false;
    }
  }
  ui.networkBootLoading = true;
  try {
    let savedSquad = null;
    try { savedSquad = localStorage.getItem('donezo.activeSquadId'); } catch { savedSquad = null; }
    await activeRepo.load((!ui.initialNavigationHandled && initialNavigation.circleId) || savedSquad || undefined);
    if (stale()) return;
    ui.networkBootLoading = false;
    ui.authoritativeReady = true;
    reapplyOptimisticPatches();
    ui.lastRefreshAt = new Date().toISOString();
    render();
    scheduleStateCacheWrite(activeRepo);
    startRefreshCoordinator(activeRepo);
    if (getNotificationCapability(window).permission === 'granted') {
      void syncPushSubscription(activeRepo).catch(() => {});
    }
    await applyInitialNavigation();
    offerPendingInvite();
  } catch (error) {
    if (stale()) return;
    ui.networkBootLoading = false;
    if (cachedRendered) {
      startRefreshCoordinator(activeRepo);
      notify('Could not refresh. Showing your last good sync. ' + readableError(error), 4200);
      renderPreservingScroll();
      return;
    }
    stopRefreshCoordinator();
    app.innerHTML = `<div class="dz-auth loading"><header class="dz-wordmark">donezo</header><h1>Could not load.</h1><p>${esc(readableError(error))}</p><button class="dz-btn primary" id="retry">Retry</button><button class="dz-link" type="button" id="sign-out">Sign out</button></div>`;
    app.querySelector('#retry')?.addEventListener('click', () => boot(ui.session));
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
  }
}

for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
}

window.DonezoPWA?.onUpdateAvailable?.(() => {
  ui.pwaUpdateAvailable = true;
  if (document.body.contains(app) && ui.session) renderPreservingScroll();
});

// Native input listeners go on before the first await so iOS never drops a selection.
bindNativeProofInputs();

const { data: { session: initialSession } } = await supabase.auth.getSession();
await boot(initialSession);
supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event === 'TOKEN_REFRESHED') return;
  queueMicrotask(() => boot(nextSession));
});
