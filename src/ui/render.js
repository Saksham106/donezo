// App shell: picks the screen for the active tab, stacks the open sheets,
// and binds every module's handlers after each innerHTML render.
import { app, screenScroll, setActiveTab, ui } from './state.js';
import { esc, icon } from './util.js';
import { handleApplyPwaUpdate, handleManualRefresh, hasUnsavedDraft } from './sync.js';
import { authScreen, bindAuth, bindSignOut } from './auth.js';
import { bindHome, closeCommentSheet, commentSheet, homeScreen, postMenuSheet, proofRejectSheet } from './home.js';
import { addFriendSheet, bindPeople, closeFriendProfile, closePeopleSheet, friendProfileSheet, friendRemovalSheet, friendsScreen, inviteSheet, peopleSheet, requestsSheet } from './people.js';
import { bindStandings, standingsScreen } from './standings.js';
import { badgeCabinet, bindProfile, historySheet, profileScreen, wrappedSheet } from './profile.js';
import { bindCheckIn, checkInSheets, closeCheckInOverlay, resetProofFlow } from './checkin.js';
import { bindHabits, habitSheet } from './habits.js';
import { batonSheet, bindSocial, challengeInfoSheet, challengeSheet, nudgeComposerSheet, pastChallengesSheet, recoverySheet, updatesSheet } from './social.js';
import { bindSettings, settingsSheet } from './settings.js';

const SCREENS = { home: homeScreen, friends: friendsScreen, standings: standingsScreen, profile: profileScreen };

function offlineIndicator() {
  return ui.online ? '' : '<div class="offline-indicator" role="status">Offline · reconnect to refresh</div>';
}

function mutationIndicator() {
  if (ui.mutationStatus === 'idle') return '';
  const copy = ({ saving: 'Saving…', saved: 'Synced', failed: ui.online ? 'Couldn’t save' : 'Offline · not saved' })[ui.mutationStatus] || '';
  return `<div class="mutation-indicator ${ui.mutationStatus}" role="status"><span>${copy}</span>${ui.mutationStatus === 'failed' && ui.retryMutation && ui.online ? '<button type="button" data-retry-mutation>Retry</button>' : ''}</div>`;
}

function pwaUpdateBanner() {
  if (!ui.pwaUpdateAvailable) return '';
  const draftOpen = hasUnsavedDraft();
  const detail = draftOpen ? 'Finish or close what you are editing first.' : 'A fresh version is ready.';
  return `<aside class="pwa-update-banner" role="status"><div><strong>${ui.pwaApplying ? 'Updating Donezo…' : 'Update ready'}</strong><small>${esc(detail)}</small></div><button class="dz-btn secondary small" type="button" data-apply-update ${ui.pwaApplying || draftOpen ? 'disabled' : ''}>${draftOpen ? 'Not yet' : ui.pwaApplying ? 'Updating…' : 'Update'}</button></aside>`;
}

function nav() {
  const item = (id, iconName, label) => `<button type="button" data-tab="${id}" class="dz-nav-btn ${ui.tab === id ? 'active' : ''}" aria-label="${label}" ${ui.tab === id ? 'aria-current="page"' : ''}>${icon(iconName, 24, ui.tab === id ? 2.3 : 1.9)}<small>${label}</small></button>`;
  return `<nav class="dz-nav" aria-label="Primary">${item('home', 'home', 'Home')}${item('friends', 'people', 'Friends')}<button type="button" data-checkin-action class="dz-nav-checkin" aria-label="Check in"><span>${icon('check', 28, 2.6)}</span><small>Check In</small></button>${item('standings', 'trophy', 'Standings')}${item('profile', 'user', 'Profile')}</nav>`;
}

function sheets() {
  return [
    habitSheet(), settingsSheet(),
    requestsSheet(), peopleSheet(), inviteSheet(), addFriendSheet(), friendProfileSheet(), friendRemovalSheet(),
    updatesSheet(), nudgeComposerSheet(),
    postMenuSheet(), proofRejectSheet(), commentSheet(),
    challengeInfoSheet(), batonSheet(), challengeSheet(), pastChallengesSheet(),
    historySheet(), badgeCabinet(), wrappedSheet(), recoverySheet(),
    checkInSheets(),
  ].join('');
}

export function render() {
  if (!ui.session) {
    app.innerHTML = authScreen();
    bindAuth(app);
    return;
  }
  app.innerHTML = `<div class="app-shell dz-app">${offlineIndicator()}${mutationIndicator()}<main class="content-scroll dz-screen ${ui.tab}" id="content-scroll">${SCREENS[ui.tab]()}</main>${pwaUpdateBanner()}${nav()}${sheets()}</div>`;
  const scroller = app.querySelector('#content-scroll');
  if (scroller) {
    scroller.scrollTop = screenScroll[ui.tab] || 0;
    scroller.onscroll = () => { screenScroll[ui.tab] = scroller.scrollTop; };
  }
  app.querySelectorAll('[data-tab]').forEach((element) => { element.onclick = () => {
    if (scroller) screenScroll[ui.tab] = scroller.scrollTop;
    setActiveTab(element.dataset.tab);
    closeSheets();
    render();
    restoreScreenScroll();
  }; });
  app.querySelectorAll('[data-close-sheet]').forEach((element) => { element.onclick = (event) => { if (event.target === element) { closeSheets(); render(); } }; });
  app.querySelectorAll('[data-apply-update]').forEach((element) => { element.onclick = handleApplyPwaUpdate; });
  app.querySelectorAll('[data-manual-refresh]').forEach((element) => { element.onclick = handleManualRefresh; });
  app.querySelector('[data-retry-mutation]')?.addEventListener('click', () => ui.retryMutation?.());
  bindHome(app);
  bindPeople(app);
  bindStandings(app);
  bindProfile(app);
  bindHabits(app);
  bindSocial(app);
  bindSettings(app);
  bindSignOut(app);
  // Check In last: it owns [data-habit] and [data-checkin-action], which other screens also render.
  bindCheckIn(app);
  bindSheetSwipeDismiss();
  bindPullToRefresh(scroller);
}

export function restoreScreenScroll() {
  const scroller = app.querySelector('#content-scroll');
  if (scroller) scroller.scrollTop = screenScroll[ui.tab] || 0;
}

export function renderPreservingScroll() {
  const contentScroll = app.querySelector('#content-scroll')?.scrollTop ?? screenScroll[ui.tab] ?? 0;
  screenScroll[ui.tab] = contentScroll;
  const sheetScroll = [...app.querySelectorAll('[data-sheet]')].at(-1)?.scrollTop ?? 0;
  render();
  const nextContent = app.querySelector('#content-scroll');
  const nextSheet = [...app.querySelectorAll('[data-sheet]')].at(-1);
  if (nextContent) nextContent.scrollTop = contentScroll;
  if (nextSheet) nextSheet.scrollTop = sheetScroll;
}

/** Closes every sheet and overlay. Tab and scroll position are untouched. */
export function closeSheets() {
  ui.habitSheetOpen = false;
  ui.editingHabitId = null;
  ui.settingsSheetOpen = false;
  ui.settingsView = 'menu';
  ui.nudgeComposerUserId = null;
  closeFriendProfile();
  ui.recoveryHabitId = null;
  ui.recoveryMissedDate = null;
  ui.challengeSheetOpen = false;
  ui.challengeInfoOpen = false;
  ui.pastChallengesOpen = false;
  ui.updatesOpen = false;
  ui.inviteSheetOpen = false;
  ui.addFriendSheetOpen = false;
  ui.requestsOpen = false;
  closePeopleSheet();
  ui.friendRemovalPerson = null;
  ui.commentCheckInId = null;
  ui.postMenuCheckInId = null;
  ui.reactionPickerCheckInId = null;
  ui.proofRejectCheckInId = null;
  ui.checkInUndoRequest = null;
  ui.batonSheetOpen = false;
  ui.badgeCabinetOpen = false;
  ui.historyOpen = false;
  ui.wrappedOpen = false;
  ui.wrappedIndex = 0;
  closeCheckInOverlay();
  resetProofFlow();
  if (window.location.search.includes('nudges=')) history.replaceState({}, '', window.location.pathname);
}

function dismissSheet(sheet) {
  if (sheet.classList.contains('comment-sheet')) { closeCommentSheet(); return; }
  if (sheet.classList.contains('people-sheet')) { closePeopleSheet(); render(); return; }
  if (sheet.classList.contains('friend-profile-sheet')) { closeFriendProfile(); render(); return; }
  closeSheets();
  render();
}

export function bindSheetSwipeDismiss() {
  const all = [...app.querySelectorAll('[data-sheet]')];
  all.forEach((sheet) => {
    if (sheet.dataset.swipeDismissBound === 'true') return;
    const backdrop = sheet.closest('.sheet-backdrop');
    if (!backdrop) return;
    sheet.dataset.swipeDismissBound = 'true';
    let tracking = false;
    let startY = 0;
    let startAt = 0;
    let dragY = 0;
    let startedFromHandle = false;

    const resetVisuals = () => {
      sheet.classList.remove('is-dragging');
      backdrop.classList.remove('is-dragging');
      sheet.style.removeProperty('transform');
      backdrop.style.removeProperty('--sheet-backdrop-alpha');
    };
    // Only the topmost sheet, and never one that is mid-upload.
    const swipeable = () => sheet.dataset.noSwipe !== 'true' && [...app.querySelectorAll('[data-sheet]')].at(-1) === sheet;

    sheet.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1 || !swipeable()) return;
      const target = event.target;
      const fromHandle = Boolean(target.closest('.sheet-handle, .sheet-head'));
      if (target.closest('input, textarea, select, button, a, label, [contenteditable="true"]')) return;
      if (!fromHandle && sheet.scrollTop > 0) return;
      tracking = true;
      startedFromHandle = fromHandle;
      startY = event.touches[0].clientY;
      startAt = performance.now();
      dragY = 0;
    }, { passive: true });

    sheet.addEventListener('touchmove', (event) => {
      if (!tracking || event.touches.length !== 1) return;
      if (!startedFromHandle && sheet.scrollTop > 0) {
        tracking = false;
        resetVisuals();
        return;
      }
      const deltaY = event.touches[0].clientY - startY;
      if (deltaY <= 0) {
        dragY = 0;
        resetVisuals();
        return;
      }
      dragY = deltaY;
      sheet.classList.add('is-dragging');
      backdrop.classList.add('is-dragging');
      sheet.style.transform = `translate3d(0, ${dragY}px, 0)`;
      backdrop.style.setProperty('--sheet-backdrop-alpha', String(Math.max(0.18, 0.42 - Math.min(0.24, dragY / 650))));
      event.preventDefault();
    }, { passive: false });

    sheet.addEventListener('touchend', () => {
      if (!tracking) return;
      const elapsed = Math.max(1, performance.now() - startAt);
      const velocity = dragY / elapsed;
      const shouldClose = dragY >= 96 || (dragY >= 36 && velocity >= 0.55);
      tracking = false;
      resetVisuals();
      if (shouldClose) dismissSheet(sheet);
    }, { passive: true });
    sheet.addEventListener('touchcancel', () => {
      tracking = false;
      resetVisuals();
    }, { passive: true });
  });
}

/** Home only: pull down from the top of the feed to refresh. */
function bindPullToRefresh(scroller) {
  const indicator = scroller?.querySelector('[data-pull-indicator]');
  if (!scroller || !indicator || ui.tab !== 'home') return;
  const THRESHOLD = 72;
  let startY = null;
  let distance = 0;
  const reset = () => {
    startY = null;
    distance = 0;
    indicator.style.removeProperty('height');
    indicator.classList.remove('ready');
  };
  scroller.addEventListener('touchstart', (event) => {
    if (scroller.scrollTop > 0 || event.touches.length !== 1 || ui.manualRefreshLoading) return;
    startY = event.touches[0].clientY;
  }, { passive: true });
  scroller.addEventListener('touchmove', (event) => {
    if (startY === null) return;
    distance = Math.max(0, event.touches[0].clientY - startY);
    if (scroller.scrollTop > 0) { reset(); return; }
    indicator.style.height = `${Math.min(THRESHOLD, distance * 0.5)}px`;
    indicator.classList.toggle('ready', distance * 0.5 >= THRESHOLD);
  }, { passive: true });
  scroller.addEventListener('touchend', () => {
    const ready = startY !== null && distance * 0.5 >= THRESHOLD;
    reset();
    if (ready) void handleManualRefresh();
  }, { passive: true });
  scroller.addEventListener('touchcancel', reset, { passive: true });
}
