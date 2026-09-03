import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createSupabaseRepository } from './store.js';
import { createRefreshCoordinator } from './refresh.js';
import { createLatestIntentCoordinator } from './optimistic.js';
import { clearStateCache, readStateCache, writeStateCache } from './state-cache.js';
import { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, redeemInvite, validateInviteCode } from './invite.js';
import { MAX_PROOF_BYTES, compressProofFile, createProofReviewState, formatProofFileSize, imageFileFromPasteData, readClipboardImage, requiresPhotoProof, transitionProofReview, validateProofFile } from './proof.js';
import { captureVideoFrame, composeDualProof, createDualProofState, dualCameraSupported, stopMediaStream, transitionDualProof } from './dual-proof.js';
import {
  BADGE_CATALOG,
  accountabilityDateForMember,
  dailyAccountabilitySummary,
  dailyProgress,
  leagueTimeLeft,
  localDateInTimeZone,
  proofRejectionThreshold,
  rankMembersByWeeklyScore,
  weeklyCompletionScore,
} from './domain.js';
import { getScheduleOccurrence } from './schedule.js';
import { buildPrivacySafeExportPayload, buildWeeklySquadRecap, weeklyChallengeProgress } from './social-domain.js';
import { resolveStake } from './stakes.js';
import { contextualHabitStatus, groupSquadActivity } from './ux.js';
import {
  enableNotifications,
  getNotificationCapability,
  parseNotificationDeepLink,
  sendTestNotification,
  shouldOfferNotificationPrompt,
  syncPushSubscription,
} from './notifications.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const proofInput = document.querySelector('#proof-input');
const proofGalleryInput = document.querySelector('#proof-gallery-input');
const dualProofMainInput = document.querySelector('#dual-proof-main-input');
const proofSelfieInput = document.querySelector('#proof-selfie-input');
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const initialNavigation = parseNotificationDeepLink(window.location.href);
const PRIMARY_TABS = ['today', 'friends', 'league', 'me'];
const legacySquadSwitcherAttribute = 'data-squad-switcher';
// Persisted squad-era deep links and fixtures remain parseable, but are not rendered in Friends.
const legacyUiMarkers = ['Join a squad', 'data-settings-view="squads"', "scheduleFrequency.value = 'selected_weekdays'", "else if (step === 4) setActiveTab('squad')"];
const THEME_KEY = 'donezo.theme';
const NOTIFICATION_PROMPT_DISMISSED_KEY = 'donezo.notificationPromptDismissed';
const requestedTab = initialNavigation.tab === 'squad'
  ? 'friends'
  : initialNavigation.tab || localStorage.getItem('donezo.activeTab') || 'today';

let repo = null;
let session = null;
let tab = PRIMARY_TABS.includes(requestedTab) ? requestedTab : 'today';

function setActiveTab(nextTab) {
  tab = PRIMARY_TABS.includes(nextTab) ? nextTab : 'today';
  localStorage.setItem('donezo.activeTab', tab);
}
let proofHabit = null;
let proofReview = null;
let proofPreparationId = 0;
let dualProof = null;
let dualCameraStream = null;
let dualCameraRequestId = 0;
let proofRejectCheckInId = null;
let checkInUndoRequest = null;
let selectedEmoji = '⚡';
let habitSheetOpen = false;
let editingHabitId = null;
let settingsSheetOpen = false;
let settingsView = 'menu';
let nudgeInboxOpen = initialNavigation.nudgesOpen;
let nudgeComposerUserId = null;
let friendProfileUserId = null;
let friendProfileReturnTab = 'friends';
let friendConnections = null;
let friendConnectionsLoading = false;
let friendConnectionsRequestId = 0;
let recoveryHabitId = null;
let challengeSheetOpen = false;
let challengeInfoOpen = false;
let stakeSheetOpen = false;
let feedLimit = 12;
let inviteSheetOpen = false;
let addFriendSheetOpen = false;
let peopleSheetOpen = false;
let peopleSearchQuery = '';
let peopleSearchResults = [];
let peopleSearchLoading = false;
let peopleSuggestions = [];
let peopleSuggestionsLoading = false;
let peopleSearchRequestId = 0;
let peopleSuggestionsRequestId = 0;
let peopleSearchDebounceTimer = null;
let discoveryProfilePerson = null;
const proofThumbnailUrls = new Map();
let commentCheckInId = null;
let batonSheetOpen = false;
let badgeCabinetOpen = false;
let wrappedOpen = false;
let wrappedIndex = 0;
let createdCircleInvite = null;
let createdFriendInvite = null;
let pendingInvite = parseInviteParam(window.location.href);
let inviteMessage = pendingInvite.present && !pendingInvite.valid
  ? 'That invite link looks busted. Paste a fresh invite code or dismiss it.'
  : '';
let refreshCoordinator = null;
let bootGeneration = 0;
let manualRefreshLoading = false;
let lastRefreshAt = null;
let online = navigator.onLine !== false;
let busy = false;
let authMode = 'sign-in';
let authMessage = '';
let initialNavigationHandled = false;
let pwaUpdateAvailable = Boolean(window.DonezoPWA?.updateAvailable);
let pwaApplying = false;
let mutationStatus = 'idle';
let retryMutation = null;
let networkBootLoading = false;
let authoritativeReady = false;
let reconciliationTimer = null;
let commentRetryDraft = null;
let prefetchedFriendInvite = null;
let friendInvitePromise = null;
let friendInvitePreparing = false;
const optimisticPatches = new Map();
const screenScroll = { today: 0, friends: 0, squad: 0, league: 0, me: 0 };

function currentThemeChoice() {
  const saved = localStorage.getItem(THEME_KEY);
  return ['light', 'dark'].includes(saved) ? saved : 'system';
}

function applyTheme(choice) {
  const next = ['light', 'dark'].includes(choice) ? choice : 'system';
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  const dark = next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1e1b18' : '#f7f2e8');
}

applyTheme(currentThemeChoice());

const starterTemplates = [
  { title: 'Move for 20 minutes', emoji: '🏃', targetTime: '18:00' },
  { title: 'Read 10 pages', emoji: '📚', targetTime: '21:00' },
  { title: 'No phone after 10', emoji: '📵', targetTime: '22:00' },
];

const getState = () => repo?.peekState?.() || repo?.getState();
function friendList(state = getState()) {
  return Array.isArray(state?.friends) ? state.friends : (state?.members || []);
}

function activityList(state = getState()) {
  return Array.isArray(state?.activities) ? state.activities : (state?.friendActivities || []);
}

function leagueMembers(state = getState()) {
  const people = friendList(state);
  const current = people.find((person) => person.id === state?.currentUserId)
    || (state?.members || []).find((person) => person.id === state?.currentUserId)
    || state?.currentUser
    || state?.user;
  return current && !people.some((person) => person.id === current.id) ? [current, ...people] : people;
}

const me = () => {
  const state = getState();
  return friendList(state).find((person) => person.id === state?.currentUserId)
    || state?.members?.find((person) => person.id === state?.currentUserId)
    || state?.currentUser
    || state?.user
    || { id: state?.currentUserId, name: 'You', avatar: '?' };
};
const today = () => localDateInTimeZone(new Date(), me()?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const member = (id) => friendList(getState()).find((item) => item.id === id)
  || getState()?.members?.find((item) => item.id === id)
  || getState()?.peopleDirectory?.find((item) => item.id === id);
const checkInFor = (habitId, userId = me()?.id, date = today()) => getState()?.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === userId && checkIn.date === date);
const done = (habitId) => {
  const checkIn = checkInFor(habitId);
  return Boolean(checkIn && !checkIn.invalid);
};
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function notify(message, duration = 2400, options = {}) {
  toast.replaceChildren(document.createTextNode(message));
  if (options.action?.label && typeof options.action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = options.action.label;
    button.onclick = () => { toast.classList.remove('show'); options.action.onClick(); };
    toast.append(button);
  }
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function haptic(pattern = 24) {
  if (typeof navigator.vibrate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(pattern);
}

function requestPortraitLock() {
  if (!window.matchMedia('(display-mode: standalone)').matches) return;
  const lockRequest = screen.orientation?.lock?.('portrait');
  lockRequest?.catch?.(() => {});
}

requestPortraitLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  requestPortraitLock();
  void startDualCameraIfNeeded();
});

function readableError(error) {
  return error?.message || 'Something went wrong';
}

const yieldToPaint = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else queueMicrotask(resolve);
});

function reapplyOptimisticPatches() {
  for (const apply of optimisticPatches.values()) {
    try { apply(); } catch { /* Authoritative refresh may make a stale patch irrelevant. */ }
  }
}

function scheduleReconciliation(delay = 650) {
  clearTimeout(reconciliationTimer);
  reconciliationTimer = setTimeout(() => { void refreshCoordinator?.request('optimistic'); }, delay);
}

function scheduleStateCacheWrite(activeRepo = repo) {
  const userId = session?.user?.id;
  if (!userId || !activeRepo) return;
  const write = () => {
    if (repo !== activeRepo || session?.user?.id !== userId) return;
    void writeStateCache(userId, activeRepo.getState());
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 1500 });
  else setTimeout(write, 0);
}

async function runOptimisticMutation({ key, apply, rollback, persist, errorMessage = 'Could not save that change', onSuccess = null }) {
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return undefined;
  }
  if (!online) {
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

function formatWhen(value) {
  const milliseconds = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatExactTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function displayDate() {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayStatus(progress) {
  const remaining = progress.total - progress.completed;
  const hour = new Date().getHours();
  if (progress.total === 0) return 'No commitments yet. Suspiciously peaceful.';
  if (remaining === 0) return 'Clean sweep. Go rot responsibly.';
  if (remaining === 1) return "One more. Don't sell.";
  if (hour >= 18 && progress.percent < 60) return 'Lock in bro 😭';
  if (hour >= 16) return "Clock's moving. Start cooking.";
  return 'Plenty of time. Start cooking.';
}

function formatTime(value) {
  if (!value) return 'Any time';
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function icon(name) {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
    squad: '<path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3"/><path d="M17 11a3 3 0 0 1 3 3v1"/><path d="M17 5.2a3 3 0 0 1 0 5.6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M12 13v4"/><path d="M8 20h8"/><path d="M6 6H4v2a3 3 0 0 0 3 3"/><path d="M18 6h2v2a3 3 0 0 1-3 3"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
    userPlus: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M19 8v6"/><path d="M16 11h6"/>',
    people: '<path d="M15.5 20v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.3a3.8 3.8 0 0 0-3.8 3.8V20"/><circle cx="9.5" cy="8" r="3"/><path d="M16 12.5a3 3 0 0 1 4.5 2.6V20"/><path d="M16.5 5.3a3 3 0 0 1 0 5.4"/>',
    challenge: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M12 14v3"/><path d="M8.5 20h7"/><path d="M5 6H3v1.5A3.5 3.5 0 0 0 6.5 11"/><path d="M19 6h2v1.5a3.5 3.5 0 0 1-3.5 3.5"/>',
    bolt: '<path d="m13 2-8 11h6l-1 9 9-12h-6z"/>',
    share: '<path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v7h14v-7"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function incomingNudges() {
  return (getState()?.nudges || []).filter((nudge) => nudge.toUserId === me()?.id);
}

function updatesList(state = getState()) {
  const nudges = incomingNudges().map((nudge) => ({
    kind: 'nudge',
    id: `nudge:${nudge.id}`,
    sourceId: nudge.id,
    userId: nudge.fromUserId,
    when: nudge.createdAt,
    message: nudge.message,
    readAt: nudge.readAt || null,
  }));
  const nativeActivities = activityList(state).filter((activity) => !activity.proofPath);
  const activities = nativeActivities.map((activity) => ({
    kind: 'activity',
    id: `activity:${activity.id}`,
    sourceId: activity.id,
    userId: activity.userId,
    when: activity.when,
    message: activity.message || `${activity.emoji || '✓'} ${activity.habitTitle || 'Habit'}`,
    activity,
  }));
  const nativeActivityCheckInIds = new Set(nativeActivities.map((activity) => activity.checkInId).filter(Boolean));
  const visibleNotificationEvents = (state?.notificationEvents || []).filter((event) => {
    if (event.category === 'nudge') return false;
    if (event.category === 'friend_activity' && nativeActivityCheckInIds.has(event.metadata?.checkInId)) return false;
    return true;
  });
  const notifications = visibleNotificationEvents.map((event) => ({
    kind: 'notification',
    id: `notification:${event.id}`,
    sourceId: event.id,
    userId: event.sourceUserId || null,
    when: event.createdAt,
    title: event.title || 'Notification',
    message: event.body || '',
    category: event.category,
    deepLink: event.deepLink || null,
  }));
  return [...nudges, ...activities, ...notifications].sort((a, b) => new Date(b.when) - new Date(a.when));
}

function unseenUpdatesCount(state = getState()) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const nativeActivities = activityList(state).filter((activity) => !activity.proofPath);
  const activityCount = nativeActivities.filter((activity) => new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges().filter((nudge) => !nudge.readAt).length;
  const nativeActivityCheckInIds = new Set(nativeActivities.map((activity) => activity.checkInId).filter(Boolean));
  const visibleNotificationEvents = (state?.notificationEvents || []).filter((event) => {
    if (event.category === 'nudge') return false;
    if (event.category === 'friend_activity' && nativeActivityCheckInIds.has(event.metadata?.checkInId)) return false;
    return true;
  });
  const notificationCount = visibleNotificationEvents.filter((event) => new Date(event.createdAt).getTime() > lastSeen).length;
  return activityCount + nudgeCount + notificationCount;
}

async function openUpdatesCenter() {
  nudgeInboxOpen = true;
  const optimisticAt = new Date().toISOString();
  repo.applyUpdatesSeen?.(optimisticAt);
  render();
  try {
    await repo.markUpdatesSeen?.();
    scheduleStateCacheWrite();
  } catch (error) {
    notify(readableError(error), 3600);
    void refreshCoordinator?.request('updates-seen-failed');
  }
  render();
}

function topbar() {
  const unread = unseenUpdatesCount();
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button><div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open Updates">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}

function offlineIndicator() {
  return online ? '' : '<div class="offline-indicator" role="status">Offline · reconnect to refresh</div>';
}

function mutationIndicator() {
  if (mutationStatus === 'idle') return '';
  const copy = ({ saving: 'Saving…', saved: 'Synced', failed: online ? 'Couldn’t save' : 'Offline · not saved' })[mutationStatus] || '';
  return `<div class="mutation-indicator ${mutationStatus}" role="status"><span>${copy}</span>${mutationStatus === 'failed' && retryMutation && online ? '<button type="button" data-retry-mutation>Retry</button>' : ''}</div>`;
}

function pwaUpdateBanner() {
  if (!pwaUpdateAvailable) return '';
  const draftOpen = hasUnsavedDraft();
  const detail = draftOpen ? 'Finish or close what you are editing first.' : 'A fresh version is ready.';
  return `<aside class="pwa-update-banner" role="status"><div><strong>${pwaApplying ? 'Updating Donezo…' : 'Update ready'}</strong><small>${esc(detail)}</small></div><button class="btn small-btn" type="button" data-apply-update ${pwaApplying || draftOpen ? 'disabled' : ''}>${draftOpen ? 'Not yet' : pwaApplying ? 'Updating…' : 'Update'}</button></aside>`;
}

function notificationOptInBanner() {
  const capability = getNotificationCapability(window);
  const dismissed = localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === '1';
  if (tab !== 'today' || !shouldOfferNotificationPrompt(capability, dismissed)) return '';
  return `<aside class="notification-opt-in-banner ${pwaUpdateAvailable ? 'stacked' : ''}" role="status"><div><strong>Get the useful nudges.</strong><small>Habit reminders and friend updates can reach you even when Donezo is closed.</small></div><div class="notification-opt-in-actions"><button class="text-btn compact" type="button" data-dismiss-notification-prompt>Dismiss</button><button class="btn primary small-btn" type="button" data-enable-notifications>Enable</button></div></aside>`;
}

function nav() {
  const item = (id, iconName, label) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''}" aria-label="${label}"><span class="nav-icon">${icon(iconName)}</span><small>${label}</small></button>`;
  return `<nav class="nav" aria-label="Primary">${item('today', 'home', 'Today')}${item('friends', 'people', 'Friends')}<button data-checkin-action class="nav-btn checkin" aria-label="Check in now"><span class="nav-icon">${icon('check')}</span><small>Check In</small></button>${item('league', 'trophy', 'League')}${item('me', 'user', 'Me')}</nav>`;
}

function openCheckInAction() {
  const state = getState();
  const next = sortedTodayHabits(actionableHabitsFor(state.currentUserId, today(), state))[0];
  if (!next) {
    setActiveTab('today');
    notify('You are all done today. Clean sweep.');
    render();
    return;
  }
  handleHabit(next.id);
}

function pageHeading(title, meta, detail = '') {
  return `<section class="page-heading"><div><p class="eyebrow">${esc(meta)}</p><h1>${esc(title)}</h1>${detail ? `<p>${esc(detail)}</p>` : ''}</div></section>`;
}

function authScreen() {
  const signingUp = authMode === 'sign-up';
  const inviteContext = pendingInvite.present
    ? pendingInvite.valid
      ? `<div class="invite-context" role="status"><strong>Invite ready</strong><p>Sign in first. You’ll confirm the friend request next.</p><button class="text-btn compact" type="button" data-dismiss-invite>Not my invite</button></div>`
      : `<div class="invite-context error" role="alert"><strong>Invite link looks off</strong><p>${esc(inviteMessage || 'Ask your friend for a fresh invite link.')}</p><button class="text-btn compact" type="button" data-dismiss-invite>Dismiss invite</button></div>`
    : '';
  return `<div class="standalone-screen auth-shell"><header class="auth-brand"><span>ϟ</span><strong>Donezo</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${pendingInvite.present ? 'Your invite stays with you while you sign in.' : signingUp ? 'Create an account, then open your Friends space.' : 'Your habits and your people are waiting.'}</p>${inviteContext}${authMessage ? `<div class="form-message">${esc(authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

function createCircleForm(primary = false, compact = false) {
  return `<form id="create-circle-form" class="form ${compact ? 'embedded-squad-form' : primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Start Friends</h2><p class="form-intro">Make one shared space for the people you want in your corner.</p><label>Space name<input name="name" maxlength="60" required placeholder="BU Crew"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Start Friends</button></form>`;
}

function joinCircleForm(primary = false, compact = false) {
  const value = pendingInvite.present ? (pendingInvite.valid ? pendingInvite.code : pendingInvite.raw || '') : '';
  return `<form id="join-circle-form" class="form ${compact ? 'embedded-squad-form' : primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Join Friends</h2><p class="form-intro">${pendingInvite.present ? 'Confirm the invite code, then connect.' : 'Paste the invite code or link a friend sent you.'}</p>${inviteMessage ? `<div class="form-message">${esc(inviteMessage)}</div>` : ''}<label>Invite code or link<input name="code" autocapitalize="none" required placeholder="Paste friend code or link" value="${esc(value)}"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Join Friends</button>${pendingInvite.present ? '<button class="text-btn compact" type="button" data-dismiss-invite>Not this invite</button>' : ''}</form>`;
}

function onboardingScreen() {
  const inviteFirst = pendingInvite.present;
  const detail = inviteFirst
    ? (pendingInvite.valid ? 'Your friend sent an invite. Confirm it below before anything happens.' : 'That invite needs attention. Paste a fresh code or dismiss it.')
    : 'Start Friends now, then invite your people.';
  return `<div class="standalone-screen onboarding-screen"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><button class="text-btn compact" id="sign-out">Sign out</button></header><main class="onboarding-content">${pageHeading(inviteFirst ? 'Join your friends' : 'Set up Friends', inviteFirst ? 'INVITE FOUND' : 'ONE LAST STEP', detail)}<div class="onboard-grid ${inviteFirst ? 'invite-first' : ''}">${inviteFirst ? `${joinCircleForm(true)}<div class="or"><span>OR</span></div>${createCircleForm(false)}` : `${createCircleForm(true)}<div class="or"><span>OR</span></div>${joinCircleForm(false)}`}</div></main></div>`;
}

function creatorInviteScreen() {
  return `<div class="standalone-screen creator-success"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div></header><main class="creator-success-body"><p class="eyebrow">FRIENDS READY</p><h1>You’re in. Bring your people.</h1><p>Share a fresh private link now, or do it later from Friends.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><button class="btn full" type="button" data-continue-app>Continue to app</button></main></div>`;
}

function myHabits(state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
}

function habitSchedule(habit) {
  return {
    frequency: habit.scheduleFrequency || habit.frequency || 'daily',
    weekdays: habit.scheduleWeekdays || [],
    weeklyTargetDays: habit.weeklyTargetDays ?? 1,
    targetQuantity: habit.targetQuantity ?? 1,
    targetUnit: habit.targetUnit || 'count',
    dueTime: habit.targetTime || null,
    graceMinutes: habit.graceMinutes || 0,
    timezone: habit.scheduleTimezone || habit.ownerTimeZone || 'UTC',
    startDate: habit.createdDate || null,
    pauseWindows: habit.pauseWindows || [],
    versions: habit.scheduleVersions || [],
  };
}

function habitIsDue(habit, date = today()) {
  try {
    return getScheduleOccurrence(habitSchedule(habit), date).scheduled;
  } catch {
    return true;
  }
}

function scheduleVersionForDate(habit, date = today()) {
  return [...(habit.scheduleVersions || [])]
    .filter((version) => version.effectiveFrom <= date && (!version.effectiveUntil || date < version.effectiveUntil))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || Number(a.version || 0) - Number(b.version || 0))
    .at(-1) || null;
}

function currentFlexibleHabit(habit, date = today()) {
  const version = scheduleVersionForDate(habit, date);
  const frequency = version?.frequency || habit.scheduleFrequency || habit.frequency || 'daily';
  if (frequency !== 'times_per_week') return null;
  const effectiveFrom = version?.effectiveFrom || habit.createdDate || date;
  const weeklyTargetDays = Number(version?.weeklyTargetDays ?? habit.weeklyTargetDays ?? 1);
  const targetQuantity = Number(version?.targetQuantity ?? habit.targetQuantity ?? 1);
  const targetUnit = version?.targetUnit || habit.targetUnit || 'count';
  const targetTime = version?.dueTime ?? habit.targetTime ?? '';
  const graceMinutes = Number(version?.graceMinutes ?? habit.graceMinutes ?? 0);
  const scheduleTimezone = version?.timezone || habit.scheduleTimezone || habit.ownerTimeZone || 'UTC';
  const scopedVersion = {
    version: Number(version?.version || 1),
    effectiveFrom,
    effectiveUntil: version?.effectiveUntil || null,
    frequency: 'times_per_week',
    weekdays: [],
    weeklyTargetDays,
    targetQuantity,
    targetUnit,
    dueTime: targetTime || null,
    graceMinutes,
    timezone: scheduleTimezone,
  };
  return {
    ...habit,
    frequency: 'times_per_week',
    scheduleFrequency: 'times_per_week',
    scheduleWeekdays: [],
    weeklyTargetDays,
    targetQuantity,
    targetUnit,
    targetTime,
    graceMinutes,
    scheduleTimezone,
    createdDate: effectiveFrom,
    scheduleVersions: [scopedVersion],
  };
}

function flexibleWeekProgress(habit, date = today(), state = getState()) {
  const scopedHabit = currentFlexibleHabit(habit, date);
  if (!scopedHabit) return null;
  const weekly = weeklyCompletionScore(habit.ownerId, [scopedHabit], state.checkIns, date);
  let paused = false;
  try { paused = getScheduleOccurrence(habitSchedule(scopedHabit), date).paused; } catch { paused = false; }
  const completedToday = state.checkIns.some((item) => (
    item.habitId === habit.id && item.userId === habit.ownerId && item.date === date && !item.invalid
  ));
  return {
    ...weekly,
    target: Number(scopedHabit.weeklyTargetDays ?? 1),
    paused,
    completedToday,
    complete: weekly.possible > 0 && weekly.completed >= weekly.possible,
    startsNextMonday: weekly.possible === 0 && !paused,
  };
}

function dueHabitsFor(memberId, date = today(), state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === memberId && habit.active && habitIsDue(habit, date));
}

function flexibleHabitsFor(memberId, date = today(), state = getState(), includeComplete = true) {
  return state.habits.filter((habit) => {
    if (habit.ownerId !== memberId || !habit.active) return false;
    const weekly = flexibleWeekProgress(habit, date, state);
    return Boolean(weekly && !weekly.paused && (includeComplete || !weekly.complete));
  });
}

function visibleHabitsFor(memberId, date = today(), state = getState()) {
  return [...dueHabitsFor(memberId, date, state), ...flexibleHabitsFor(memberId, date, state, true)];
}

function actionableHabitsFor(memberId, date = today(), state = getState()) {
  const fixed = dueHabitsFor(memberId, date, state).filter((habit) => !state.checkIns.some((item) => (
    item.habitId === habit.id && item.userId === memberId && item.date === date && !item.invalid
  )));
  const flexible = flexibleHabitsFor(memberId, date, state, false).filter((habit) => !flexibleWeekProgress(habit, date, state)?.completedToday);
  return [...fixed, ...flexible];
}

function progressFor(memberId, date = today()) {
  const state = getState();
  const habits = dueHabitsFor(memberId, date, state);
  const completed = habits.filter((habit) => {
    const checkIn = state.checkIns.find((item) => item.habitId === habit.id && item.userId === memberId && item.date === date);
    return checkIn && !checkIn.invalid;
  }).length;
  return dailyProgress(completed, habits.length);
}

function sortedTodayHabits(habits) {
  return [...habits].sort((a, b) => Number(done(a.id)) - Number(done(b.id)) || (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99') || a.title.localeCompare(b.title));
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekBounds(dateString = today()) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  const start = date.toISOString().slice(0, 10);
  return { start, end: shiftDate(start, 6) };
}

function formatLeagueWeekRange(bounds = weekBounds()) {
  const format = (dateString, weekday) => new Intl.DateTimeFormat('en-US', {
    weekday,
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateString}T12:00:00Z`));
  return `${format(bounds.start, 'short')} – ${format(bounds.end, 'short')}`;
}

function missedHabits() {
  const state = getState();
  const yesterday = shiftDate(today(), -1);
  return myHabits(state).filter((habit) => {
    const existed = !habit.createdDate || habit.createdDate <= yesterday;
    const expected = habitIsDue(habit, yesterday);
    const checked = state.checkIns.some((item) => item.habitId === habit.id && item.userId === state.currentUserId && item.date === yesterday && !item.invalid);
    const recovered = (state.recoveries || []).some((item) => item.habitId === habit.id && item.missedDate === yesterday);
    return existed && expected && !checked && !recovered;
  }).map((habit) => ({ ...habit, missedDate: yesterday }));
}

function activationCard() {
  const state = getState();
  const hasFriendsWorkspace = Array.isArray(state?.friends) || Array.isArray(state?.activities);
  const steps = [
    { done: Boolean(state.circleId) || hasFriendsWorkspace, label: 'Open Friends' },
    { done: myHabits(state).length > 0, label: 'Add a habit' },
    { done: friendList(state).length > 1, label: 'Invite a friend' },
    { done: state.checkIns.some((item) => item.userId === state.currentUserId && !item.invalid), label: 'Post your first check-in' },
    { done: (state.reactions || []).some((item) => item.userId === state.currentUserId && item.emoji !== '👎'), label: 'Hype a friend' },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return '';
  const next = steps.findIndex((step) => !step.done);
  return `<section class="activation-card"><div class="activation-mark" aria-hidden="true">${completed}/${steps.length}</div><div class="activation-copy"><span>Next setup step</span><strong>${esc(steps[next].label)}</strong><small>Finish this once, then it gets out of your way.</small></div><button class="btn primary small-btn" type="button" data-activation-next="${next}">${['Set up', 'Add', 'Invite', 'Check in', 'Open'][next]}</button></section>`;
}

function habitCard(habit, actionMode = false) {
  const checkIn = checkInFor(habit.id);
  const checkedToday = Boolean(checkIn && !checkIn.invalid);
  const rejected = Boolean(checkIn?.invalid);
  const weekly = flexibleWeekProgress(habit);
  const isDone = weekly ? (weekly.complete || checkedToday) : checkedToday;
  const action = rejected
    ? 'Run it back'
    : weekly?.complete
      ? 'Week done'
      : checkedToday
        ? 'Done today'
        : habit.proofMode === 'photo' ? 'Add proof' : 'Check in';
  const target = Number(habit.targetQuantity ?? 1) !== 1 || (habit.targetUnit && habit.targetUnit !== 'count')
    ? `${habit.targetQuantity ?? 1} ${habit.targetUnit || 'count'} · `
    : '';
  const timing = weekly ? '' : contextualHabitStatus({ ...habit, completedAt: isDone ? checkIn?.completedAt : null, invalid: rejected }, { date: today() });
  const weeklyDetail = weekly
    ? weekly.startsNextMonday
      ? 'Goal starts next Monday'
      : `${weekly.completed} of ${weekly.possible} this week${weekly.complete ? ' · Week complete' : checkedToday ? ' · Done today' : ''}`
    : '';
  const detail = rejected
    ? 'Proof needs another try'
    : weekly
      ? `${target}${weeklyDetail}${habit.proofMode === 'photo' ? ' · Proof required' : ' · Truuust mode'}`
      : `${target}${timing}${habit.proofMode === 'photo' ? ' · Proof required' : ' · Truuust mode'}`;
  return `<button class="habit ${isDone ? 'done' : ''} ${rejected ? 'rejected' : ''}" data-habit="${habit.id}" ${busy ? 'disabled' : ''}><span class="habit-icon">${esc(habit.emoji)}</span><span class="habit-copy"><strong>${esc(habit.title)}</strong><small>${esc(detail)}</small></span>${actionMode ? `<span class="habit-action ${isDone ? 'complete' : ''} ${rejected ? 'rejected' : ''}">${action}</span>` : `<span class="check">${isDone ? '✓' : rejected ? '↻' : ''}</span>`}</button>`;
}

function todayScreen() {
  const state = getState();
  const habits = sortedTodayHabits(visibleHabitsFor(state.currentUserId, today(), state));
  const flexible = flexibleHabitsFor(state.currentUserId, today(), state, true);
  const progress = progressFor(state.currentUserId);
  const remaining = progress.total - progress.completed;
  const firstName = me().name.split(/\s+/)[0];
  const list = habits.length ? habits.map((habit) => habitCard(habit)).join('') : '<div class="empty"><b>Nothing due today.</b><p>Your active habits are either paused or waiting for their next scheduled day.</p><button class="btn primary" data-open-habit>Add habit</button></div>';
  const progressCopy = progress.total === 0
    ? flexible.length ? 'Flexible weekly goals are in progress.' : 'Add one thing worth showing up for.'
    : remaining === 0 ? 'Clean sweep. You are done with fixed commitments today.' : `${remaining} ${remaining === 1 ? 'thing' : 'things'} left.`;
  const headingStatus = progress.total === 0 && flexible.length
    ? 'Your flexible goals move when your week does.'
    : todayStatus(progress);
  return `${pageHeading(`${greeting()}, ${firstName}`, displayDate(), headingStatus)}${activationCard()}<section class="today-progress"><div><strong>${progress.completed}/${progress.total}</strong><span>${esc(progressCopy)}</span></div><div class="bar" role="progressbar" aria-label="Today fixed-schedule progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div></section><div class="section-head first"><h2>Today</h2><span>${progress.percent}%</span></div><div class="habit-list">${list}</div>`;
}

function checkInScreen() {
  const state = getState();
  const habits = visibleHabitsFor(state.currentUserId, today(), state);
  const incompleteIds = new Set(actionableHabitsFor(state.currentUserId, today(), state).map((habit) => habit.id));
  const incomplete = habits.filter((habit) => incompleteIds.has(habit.id)).sort((a, b) => (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99'));
  const completed = habits.filter((habit) => !incompleteIds.has(habit.id));
  const progress = progressFor(state.currentUserId);
  return `${pageHeading('Check in', `${progress.completed}/${progress.total} FIXED DONE TODAY`, incomplete.length ? `${incomplete.length} available. Tap one and get the receipt.` : 'You are clear. Touch grass or something.')}<section class="checkin-progress"><div><b>${progress.percent}%</b><span>fixed schedule</span></div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Available</h2><span>${incomplete.length}</span></div><div class="habit-list">${incomplete.length ? incomplete.map((habit) => habitCard(habit, true)).join('') : '<div class="empty compact-empty"><b>All done.</b><p>No check-in is waiting on you right now.</p></div>'}</div>${completed.length ? `<div class="section-head subdued"><h2>Completed</h2><span>${completed.length}</span></div><div class="habit-list completed-list">${completed.map((habit) => habitCard(habit, true)).join('')}</div>` : ''}`;
}

function activityProfileButton(userId, primary, secondary) {
  const person = member(userId);
  return `<button class="activity-profile" type="button" data-friend-profile="${userId}" aria-label="Open ${esc(person?.name || 'friend')} profile"><div class="avatar">${esc(person?.avatar || '?')}</div><span><strong>${primary}</strong><small>${secondary}</small></span></button>`;
}

function proofReplyPreview(checkInId) {
  const comments = (getState()?.comments || [])
    .filter((comment) => comment.checkInId === checkInId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (!comments.length) return '';
  const visible = comments.slice(-2);
  const rows = visible.map((comment) => {
    const author = member(comment.authorId);
    const label = comment.authorId === getState()?.currentUserId
      ? 'You'
      : (author?.handle || author?.name || 'Friend');
    return `<div class="proof-reply-row"><button class="proof-reply-author" type="button" data-friend-profile="${comment.authorId}" aria-label="Open ${esc(author?.name || 'friend')} profile">${esc(label)}</button><span>${esc(comment.body)}</span></div>`;
  }).join('');
  const more = comments.length > 2
    ? `<button class="proof-reply-all" type="button" data-comment-open="${checkInId}" aria-label="View all ${comments.length} replies">More</button>`
    : '';
  return `<div class="proof-reply-preview">${rows}${more}</div>`;
}

function activityCard(activity, { showProofActions = false } = {}) {
  const actor = member(activity.userId);
  const mine = activity.userId === me().id;
  if (activity.type === 'callout') {
    const target = member(activity.toUserId);
    return `<article class="activity callout"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')} called out ${esc(target?.name || 'a friend')}`, `${esc(formatWhen(activity.when))} · visible to this group`)}</div><div class="callout-message"><span>⚡</span><p>${esc(activity.message)}</p></div></article>`;
  }
  if (['missed', 'recovered', 'recovery'].includes(activity.type)) {
    const recovered = activity.type === 'recovered';
    const missed = activity.type === 'missed';
    const verb = missed ? 'missed one' : recovered ? 'came back' : 'made a recovery move';
    return `<article class="activity ${activity.type}"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')} ${verb}`, esc(formatWhen(activity.when)))}</div><div class="activity-body"><span>${missed ? '○' : '↩'}</span><div><strong>${esc(activity.emoji)} ${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${!mine && !missed ? `<button class="btn small-btn" data-nudge="${activity.userId}">Send support</button>` : ''}</article>`;
  }
  const checkIn = getState().checkIns.find((item) => item.id === activity.checkInId);
  const threshold = proofRejectionThreshold(activity.audienceSize);
  const rejectionLabel = `${activity.downvotes || 0}${Number.isFinite(threshold) ? `/${threshold}` : ''}`;
  const rejectionControl = showProofActions && activity.proofPath
    ? mine
      ? `<span class="vote-btn proof-rejection-inline proof-rejection-status ${activity.invalid ? 'active' : ''}" aria-label="${activity.invalid ? 'Proof rejected' : `${activity.downvotes || 0} proof rejection${activity.downvotes === 1 ? '' : 's'} so far`}">👎 <span>${rejectionLabel}</span></span>`
      : `<button type="button" class="vote-btn proof-rejection-inline ${activity.userDownvoted ? 'active' : ''}" data-request-reject="${activity.checkInId}" aria-label="${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}">👎 <span>${rejectionLabel}</span></button>`
    : '';
  const proofPreview = showProofActions && activity.proofPath ? `<div class="proof-media" data-proof-image="${esc(activity.proofPath)}" aria-label="${esc(activity.habitTitle)} proof"><span aria-hidden="true">📷</span><small>Loading proof…</small></div>` : '';
  const proofActions = showProofActions && activity.proofPath && mine && activity.invalid ? `<div class="proof-actions"><button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button></div>` : '';
  const commentCount = (getState().comments || []).filter((comment) => comment.checkInId === activity.checkInId).length;
  const mineReactions = (activity.userReactions || []).slice(-1);
  const visibleReactionCounts = { ...(activity.reactionCounts || {}) };
  mineReactions.forEach((emoji) => {
    visibleReactionCounts[emoji] = Math.max(1, Number(visibleReactionCounts[emoji] || 0));
  });
  const reactionTotal = Object.values(visibleReactionCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const reactionSummary = mineReactions.length
    ? `You reacted ${mineReactions[0]} · ${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}`
    : reactionTotal ? `${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}` : '';
  const reactionButtons = ['👏', '🔥', '💪', '😂'].map((emoji) => { const active = mineReactions.includes(emoji); return `<button type="button" class="reaction-btn ${active ? 'active' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" aria-pressed="${active}">${emoji}<span>${visibleReactionCounts[emoji] || 0}</span></button>`; }).join('');
  const positiveReactions = `<div class="activity-social-actions"><div><div class="reaction-row" aria-label="React to this check-in">${reactionButtons}</div><small class="reaction-summary" aria-live="polite">${esc(reactionSummary)}</small></div><button type="button" class="comment-open" data-comment-open="${activity.checkInId}">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;
  const activityMessage = activity.message === 'Done. Proof beats promises.' ? '' : activity.message;
  if (activity.proofPath) {
    const actorLabel = mine ? 'You' : esc(actor?.name || 'Friend');
    const actorHandle = !mine && actor?.handle ? ` ${esc(actor.handle)}` : '';
    const invalidLabel = activity.invalid ? ' · cooked 💀' : '';
    return `<article class="activity proof-activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="proof-card-header"><div class="proof-card-heading-copy"><div class="proof-card-title"><span aria-hidden="true">${esc(activity.emoji)}</span><strong>${esc(activity.habitTitle)}</strong></div><div class="proof-card-byline"><button class="proof-card-author" type="button" data-friend-profile="${activity.userId}" aria-label="Open ${esc(actor?.name || 'friend')} profile">${actorLabel}${actorHandle}${invalidLabel}</button><span>· ${esc(`${formatWhen(activity.when)} · ${formatExactTime(activity.when)}`)}</span><span>· 🔥 ${activity.streak}</span></div></div>${rejectionControl}</div>${proofPreview}${activityMessage ? `<p class="proof-card-note">${esc(activityMessage)}</p>` : ''}${proofActions}${positiveReactions}${proofReplyPreview(activity.checkInId)}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
  }
  return `<article class="activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')}${activity.invalid ? ' · cooked 💀' : ''}`, `${esc(formatWhen(activity.when))} · 🔥 ${activity.streak}`)}</div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong>${activityMessage ? `<p>${esc(activityMessage)}</p>` : ''}</div></div>${proofPreview}${proofActions}${positiveReactions}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
}

function personProofCarousel(userId, activities) {
  const proofs = (activities || [])
    .filter((activity) => activity.userId === userId && activity.proofPath)
    .sort((a, b) => new Date(b.when) - new Date(a.when));
  if (!proofs.length) return '<p class="profile-connection-state">No photo proofs yet.</p>';
  return `<div class="profile-proof-carousel" aria-label="Newest proofs first">${proofs.map((proof) => `<div class="profile-proof-card">${activityCard(proof, { showProofActions: true })}</div>`).join('')}</div>`;
}

function batonCard() {
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const holder = baton ? member(baton.holderUserId) : null;
  const mine = baton?.holderUserId === state.currentUserId;
  const eligibleCheckIn = state.checkIns.find((item) => item.userId === state.currentUserId && !item.invalid);
  const hasFriend = friendList(state).some((person) => person.id !== state.currentUserId);
  if (!baton) {
    if (!hasFriend) return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Invite a friend</strong><small>Hand off the next move.</small></div><button class="baton-action" type="button" data-invite-from-baton>Invite</button></section>`;
    if (!eligibleCheckIn) return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Check in to start</strong><small>Then pick who goes next.</small></div><button class="baton-action" type="button" data-baton-checkin>Go</button></section>`;
    return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Pick who’s next</strong><small>Keep the momentum moving.</small></div><button class="baton-action" type="button" data-baton-open>Start</button></section>`;
  }
  return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>${mine ? 'Baton · Your turn' : `The baton is with ${esc(holder?.name || 'a friend')}`}</strong><small>${mine ? 'Check in, then pass it on.' : 'One turn at a time.'}</small></div>${mine && eligibleCheckIn && hasFriend ? '<button class="baton-action" type="button" data-pass-baton>Pass</button>' : ''}</section>`;
}

function squadScreen() {
  return friendsScreen();
}

function friendsScreen() {
  const state = getState();
  const feed = activityList(state).filter((activity) => activity.proofPath);
  const visibleActivities = feed.slice(0, feedLimit);
  const activities = visibleActivities.map((activity) => activityCard(activity, { showProofActions: true })).join('');
  const loadMore = feed.length > visibleActivities.length ? `<button class="btn full load-more" type="button" data-load-more>Load older proofs</button>` : '';
  const refreshButton = `<button class="refresh-btn ${manualRefreshLoading ? 'loading' : ''}" type="button" data-manual-refresh aria-label="Refresh Friends" title="Refresh" ${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span></button>`;
  const incomingRequests = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId).length;
  const peopleButton = `<button class="invite-icon-btn people-entry-btn" type="button" data-people-open aria-label="View friends" title="Friends">${icon('people')}${incomingRequests ? `<span class="people-request-badge">${incomingRequests > 9 ? '9+' : incomingRequests}</span>` : ''}</button>`;
  const empty = '<div class="empty compact-empty"><b>No proofs yet.</b><p>Post a photo check-in and give your friends something to react to.</p><button class="btn primary empty-action" type="button" data-empty-checkin>Check in</button></div>';
  return `<section class="friends-heading"><div class="friends-heading-row"><h1>Friends</h1><div class="friends-heading-actions">${refreshButton}${peopleButton}</div></div></section><div class="activity-list">${activities || empty}${loadMore}</div>`;
}

function challengeProgress(challenge) {
  const state = getState();
  const result = weeklyChallengeProgress({
    ...challenge,
    metric: challenge.kind,
    weekStart: challenge.startsOn,
    weekEnd: challenge.endsOn,
  }, {
    members: friendList(state),
    habits: state.habits,
    checkIns: state.checkIns,
    asOfDate: today() < challenge.endsOn ? today() : challenge.endsOn,
  });
  return { value: result.completed, total: result.total, percent: result.percent, status: result.status };
}

function activeChallengeCard() {
  const challenge = (getState().challenges || []).find((item) => item.status === 'active' && item.endsOn >= today());
  if (!challenge) return '';
  const progress = challengeProgress(challenge);
  return `<section class="challenge-card"><div class="challenge-copy"><span>Weekly challenge · ${esc(progress.status.replace('_', ' '))}</span><strong>${esc(challenge.title)}</strong><small>${progress.value}/${progress.total} · ends ${esc(challenge.endsOn)}</small></div><div class="challenge-meter" role="progressbar" aria-label="Challenge progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div><b>${progress.percent}%</b></section>`;
}

function challengeHistory() {
  const history = (getState().challenges || []).filter((item) => item.status !== 'active' || item.endsOn < today()).slice(0, 3);
  if (!history.length) return '';
  return `<section class="challenge-history"><div class="section-head"><h2>Past challenges</h2><span>${history.length}</span></div>${history.map((challenge) => {
    const progress = challengeProgress(challenge);
    const result = challenge.status === 'cancelled' ? 'cancelled' : progress.percent >= 100 ? 'completed' : 'finished';
    return `<div class="challenge-history-row"><span><strong>${esc(challenge.title)}</strong><small>${esc(challenge.startsOn)} – ${esc(challenge.endsOn)}</small></span><b>${progress.percent}% · ${result}</b></div>`;
  }).join('')}</section>`;
}

function weeklyRecapCard() {
  const state = getState();
  const recap = currentWeeklyRecap();
  const awardText = (award, suffix = '') => award.memberIds.length
    ? `${award.memberIds.map((id) => member(id)?.name || 'Friend').join(' + ')}${suffix}`
    : 'No award yet';
  const change = recap.summary.changePoints;
  return `<section class="recap-card" id="weekly-recap"><div class="recap-head"><div><span>Week in review</span><strong>${esc(state.circleName)}</strong></div><b>${recap.summary.completionPercent}%</b></div><p>${change >= 0 ? `Up ${change} points from last week.` : `Down ${Math.abs(change)} points. Fresh week, clean slate.`}</p><div class="recap-highlights"><span><small>Best streak</small><strong>${esc(awardText(recap.awards.bestStreak, recap.awards.bestStreak.value ? ` · ${recap.awards.bestStreak.value}d` : ''))}</strong></span><span><small>Biggest jump</small><strong>${esc(awardText(recap.awards.biggestImprovement, recap.awards.biggestImprovement.value ? ` · +${recap.awards.biggestImprovement.value}` : ''))}</strong></span><span><small>Fastest comeback</small><strong>${esc(awardText(recap.awards.fastestRecovery, recap.awards.fastestRecovery.memberIds.length ? ` · ${recap.awards.fastestRecovery.value}d` : ''))}</strong></span><span><small>Most supportive</small><strong>${esc(awardText(recap.awards.mostSupportive))}</strong></span></div><button class="btn primary full" type="button" data-share-recap>Share recap</button></section>`;
}

function currentWeeklyRecap() {
  const state = getState();
  const period = weekBounds();
  const misses = [];
  for (let date = period.start; date <= today() && date <= period.end; date = shiftDate(date, 1)) {
    for (const habit of state.habits) {
      if (!habit.active || !habitIsDue(habit, date)) continue;
      const checked = state.checkIns.some((item) => item.habitId === habit.id && item.userId === habit.ownerId && item.date === date && !item.invalid);
      if (!checked) misses.push({ habitId: habit.id, userId: habit.ownerId, date });
    }
  }
  return buildWeeklySquadRecap({
    members: friendList(state),
    habits: state.habits,
    checkIns: state.checkIns,
    misses,
    recoveries: state.recoveries,
    nudges: state.nudges,
    reactions: state.reactions,
    weekStart: period.start,
    weekEnd: period.end,
    asOfDate: today() < period.end ? today() : period.end,
    nextGoal: { title: 'Start next week together', cta: 'Create a challenge' },
  });
}

async function createRecapImage() {
  const state = getState();
  if (!document.querySelector('#weekly-recap')) return null;
  const payload = buildPrivacySafeExportPayload(currentWeeklyRecap());
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f2e8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ef6548';
  context.fillRect(64, 64, 120, 120);
  context.fillStyle = '#1d2433';
  context.font = '700 52px system-ui';
  context.fillText('Donezo', 216, 142);
  context.font = '800 78px system-ui';
  context.fillText(`${state.circleName} showed up`, 64, 330);
  context.font = '800 220px system-ui';
  context.fillText(`${payload.summary.completionPercent}%`, 64, 620);
  context.font = '500 40px system-ui';
  context.fillText('group completion this week', 72, 690);
  context.font = '700 48px system-ui';
  payload.participants.slice(0, 3).forEach((person, index) => context.fillText(`${person.name}  ${person.completionPercent}%`, 72, 820 + (index * 90)));
  context.font = '500 34px system-ui';
  context.fillText('No proof photos or private messages included.', 72, 1260);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function leagueScreen() {
  const state = getState();
  const period = weekBounds();
  const weekRange = formatLeagueWeekRange(period);
  const timeLeft = leagueTimeLeft(period.end, today());
  const ranked = rankMembersByWeeklyScore(leagueMembers(state), state.habits, state.checkIns, today());
  const mine = ranked.find((item) => item.id === me().id);
  const leader = ranked[0];
  const gap = leader && mine ? Math.max(0, leader.weeklyPoints - mine.weeklyPoints) : 0;
  const stake = (state.stakes || []).find((item) => ['pending', 'active'].includes(item.status));
  const myConsent = stake ? (state.stakeConsents || []).find((item) => item.stakeId === stake.id && item.userId === me().id) : null;
  const canResolve = stake?.status === 'active' && stake.createdBy === me().id && today() > stake.endsOn;
  const stakeCard = stake ? `<section class="stake-card legacy-stake"><div><span>${stake.status === 'active' ? 'Existing stake' : 'Existing opt-in'}</span><strong>${esc(stake.reward || stake.consequence)}</strong><small>We retired new stakes. This one stays until the challenge ends or passes.</small></div>${stake.status === 'pending' && myConsent?.status !== 'accepted' ? `<div class="stake-actions"><button class="btn primary" data-stake-response="accepted" data-stake-id="${stake.id}">I’m in</button><button class="btn" data-stake-response="declined" data-stake-id="${stake.id}">Pass</button></div>` : ''}${canResolve ? `<button class="btn small-btn" data-resolve-stake="${stake.id}">Resolve</button>` : ''}</section>` : '';
  const accountabilityNow = new Date();
  const standings = ranked.map((item) => {
    const memberDate = accountabilityDateForMember(item, accountabilityNow);
    const daily = dailyAccountabilitySummary(item.id, state.habits, state.checkIns, memberDate);
    const todayLabel = daily.today.total
      ? `Today ${daily.today.completed}/${daily.today.total}${daily.today.remaining.length ? ` · ${daily.today.remaining.length} left` : ' · clear'}`
      : 'Today · no habits';
    const missed = daily.yesterday.missed;
    const yesterdayLabel = daily.yesterday.total === 0
      ? 'Yesterday · no habits'
      : missed.length
        ? `Yesterday · missed ${missed.slice(0, 2).map((habit) => `${habit.emoji || '○'} ${habit.title}`).join(', ')}${missed.length > 2 ? ` +${missed.length - 2}` : ''}`
        : 'Yesterday · clean';
    return `<button type="button" class="league-row" data-friend-profile="${item.id}" aria-label="Open ${esc(item.name)} profile"><b>${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`}</b><div class="avatar">${esc(item.avatar)}</div><span><strong class="league-name ${item.id === me().id ? 'mine' : ''}">${esc(item.name)}${item.id === me().id ? ' · you' : ''}</strong><small>${item.weeklyCompleted}/${item.weeklyPossible} · ${item.weeklyScore}% complete · 🔥 ${item.currentStreak}</small><span class="league-daily-status"><small>${esc(todayLabel)}</small><small class="league-yesterday ${missed.length ? 'missed' : ''}">${esc(yesterdayLabel)}</small></span></span><strong>${item.weeklyPoints} pts</strong></button>`;
  }).join('');
  return `<div class="league-title-row">${pageHeading('Your League', weekRange.toUpperCase(), timeLeft)}<div class="league-header-actions"><button class="league-header-action info" type="button" data-challenge-info aria-label="How do League points work?" title="League points">${icon('eye')}</button><button class="league-header-action start" type="button" data-challenge aria-label="Start a weekly challenge" title="Start challenge">${icon('target')}</button></div></div><section class="league-summary"><span>Your rank</span><div><b>#${mine?.rank || '—'}</b><strong>${mine?.weeklyPoints || 0} pts</strong></div><small>${mine?.weeklyScore || 0}% complete · ${mine?.weeklyCompleted || 0}/${mine?.weeklyPossible || 0} commitments${leader?.id === mine?.id ? ' · You are on top. Act normal.' : ` · ${gap} pts behind ${esc(leader?.name || 'leader')}.`}</small></section><div class="section-head first"><h2>Standings</h2><span>${ranked.length}</span></div><div class="league-list">${standings}</div>${activeChallengeCard()}${stakeCard}${challengeHistory()}${stake ? stakeHistory() : ''}`;
}

function challengeInfoSheet() {
  if (!challengeInfoOpen) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet challenge-info-sheet" role="dialog" aria-modal="true" aria-label="League points and actions" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">LEAGUE POINTS</p><h2>More work counts. Spam doesn’t.</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><section class="league-action-section league-points-rules"><p><strong>Completed commitments</strong><br>First 3 each day earn 10 points. The 4th earns 5, the 5th earns 2. Anything beyond that does not pad the table.</p><p><strong>Clean-day bonus</strong><br>Finish everything due that day for 5 extra points.</p><p><strong>Anti-spam lock</strong><br>New habits unlock volume points after 2 separate days. They still count toward your completion rate immediately.</p><small>The League runs Monday through Sunday and resets every Monday.</small></section><section class="league-action-section"><div class="challenge-explainer"><span>${icon('target')}</span><p><strong>Weekly challenge</strong><br>Pick one shared target. Real check-ins move the same progress bar.</p></div><button class="btn primary full" type="button" data-challenge>Start a challenge</button></section><section class="league-action-section"><p class="eyebrow">PASS THE MOMENTUM</p>${batonCard()}</section></section></div>`;
}

function stakeHistory() {
  const history = (getState().stakes || []).filter((item) => ['resolved', 'declined'].includes(item.status)).slice(0, 3);
  if (!history.length) return '';
  return `<details class="social-history"><summary>Past stakes</summary><div>${history.map((stake) => {
    if (stake.status === 'declined') return `<article><strong>${esc(stake.reward || stake.consequence)}</strong><small>Passed. No pressure, no penalty.</small></article>`;
    const resultIds = stake.rule === 'loser' ? (stake.resolution?.losers || []) : (stake.resolution?.winners || []);
    const resultNames = resultIds.map((id) => member(id)?.name).filter(Boolean);
    const result = stake.rule === 'all_succeed'
      ? (stake.resolution?.allSucceeded ? 'Everybody did it 🤝' : 'Not this time. Reset and run it back.')
      : resultNames.length ? `${resultNames.map(esc).join(', ')} ${resultNames.length === 1 ? 'takes it' : 'take it'} ${stake.rule === 'loser' ? '😅' : '🏆'}` : 'Finished with no result';
    return `<article><strong>${esc(stake.reward || stake.consequence)}</strong><small>${result}</small></article>`;
  }).join('')}</div></details>`;
}

function habitSettingsRow(habit) {
  return `<button type="button" class="habit-setting habit-setting-button" data-edit-habit="${habit.id}" aria-label="Edit ${esc(habit.title)}"><span>${esc(habit.emoji)}</span><div><strong>${esc(habit.title)}</strong><small>${esc(formatTime(habit.targetTime))}${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}</small></div><span class="setting-chevron" aria-hidden="true">›</span></button>`;
}

function previousMonthKey() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, value - 1, 1)));
}

function badgeIcon(category) {
  return ({ streak: '🔥', completion: '✓', consistency: '◆', variety: '✦', proof: '🧾', baton: '↗', longevity: '⌛' })[category] || '✦';
}

function earnedBadges() {
  return repo.getEarnedBadges({ asOfDate: today(), timeZone: me()?.timeZone || 'UTC' });
}

function badgePreview() {
  const earned = earnedBadges();
  const visible = earned.slice(-3).reverse();
  return `<section class="badge-preview"><div class="settings-title"><div><strong>Milestones</strong><p>${earned.length} of ${BADGE_CATALOG.length} unlocked</p></div><button class="btn small-btn" type="button" data-badge-cabinet>View all</button></div>${visible.length ? `<div class="badge-grid">${visible.map((badge) => `<article class="badge-tile earned" title="${esc(badge.description)}"><i>${badgeIcon(badge.category)}</i><strong>${esc(badge.name)}</strong></article>`).join('')}</div>` : '<p class="settings-empty">Your first badge is one check-in away.</p>'}</section>`;
}

function wrappedEntry() {
  const month = previousMonthKey();
  const wrapped = repo.getMonthlyWrapped(month, { asOfDate: today(), timeZone: me()?.timeZone || 'UTC', recapOptOut: me()?.awardOptOut });
  if (!wrapped.summary.completionCount) return '';
  return `<button class="wrapped-entry" type="button" data-wrapped-open><span><small>${esc(monthLabel(month).toUpperCase())}</small><strong>Your month, wrapped</strong><p>${wrapped.summary.completionCount} check-ins. See the friend awards.</p></span><b aria-hidden="true">›</b></button>`;
}

function meScreen() {
  const state = getState();
  const total = state.checkIns.filter((checkIn) => checkIn.userId === me().id && !checkIn.invalid).length;
  const weekly = weeklyCompletionScore(me().id, state.habits, state.checkIns, today());
  const habits = myHabits(state);
  const ringStyle = `--progress:${Math.max(0, Math.min(100, weekly.percent)) * 3.6}deg`;
  return `${pageHeading(me().name, me().handle || session.user.email, 'Your week, your receipts.')}<section class="me-progress-hero"><div class="progress-ring" style="${ringStyle}" role="progressbar" aria-label="Weekly completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${weekly.percent}"><span><b>${weekly.percent}%</b><small>this week</small></span></div><div class="me-progress-copy"><span>PERSONAL PACE</span><h2>${weekly.percent >= 100 ? 'Clean week.' : weekly.percent >= 70 ? 'You are cooking.' : weekly.percent ? 'Keep stacking reps.' : 'Start with one.'}</h2><p>${weekly.completed}/${weekly.possible} commitments landed.</p></div></section><section class="me-stat-chips"><span><b>🔥 ${me().currentStreak}</b><small>day streak</small></span><span><b>${total}</b><small>check-ins</small></span><span><b>${friendList(state).length}</b><small>friends</small></span></section>${wrappedEntry()}${badgePreview()}<section class="settings-group clean-group"><div class="settings-title"><div><strong>Your habits</strong><p>${habits.length} active</p></div><button class="btn primary small-btn" data-open-habit>Add habit</button></div><div class="habit-settings-list">${habits.length ? habits.map(habitSettingsRow).join('') : '<div class="empty compact-empty"><b>No habits yet.</b><p>Add one commitment you can actually keep.</p><button class="btn primary empty-action" data-open-habit>Add first habit</button></div>'}</div></section>`;
}

function habitAudience(habit, state = getState()) {
  const friendIds = friendList(state).map((friend) => friend.id).filter((id) => id !== state?.currentUserId);
  const rawIds = habit?.audienceIds || habit?.selectedFriendIds || habit?.friendIds || [];
  const legacyIds = habit?.squadIds || [];
  const rawMode = habit?.audienceMode || habit?.audience;
  const mode = ['all_friends', 'selected_friends', 'only_me'].includes(rawMode)
    ? rawMode
    : legacyIds.length ? 'selected_friends' : 'all_friends';
  const audienceIds = new Set((rawIds.length ? rawIds : legacyIds).filter((id) => friendIds.includes(id)));
  return { friendIds, mode, audienceIds };
}

function habitSheet() {
  if (!habitSheetOpen) return '';
  const emojis = ['⚡', '🏃', '🏋️', '📚', '🧠', '📵'];
  const editing = editingHabitId
    ? getState().habits.find((habit) => habit.id === editingHabitId && habit.ownerId === getState().currentUserId && habit.active)
    : null;
  const editMode = Boolean(editing);
  const title = editing?.title || '';
  const targetTime = editMode ? (editing.targetTime ?? '') : '20:00';
  const proofMode = editing?.proofMode || 'photo';
  const scheduleFrequency = editing?.scheduleFrequency || editing?.frequency || 'daily';
  const scheduleWeekdays = new Set(editing?.scheduleWeekdays || []);
  const weeklyTargetDays = Number(editing?.weeklyTargetDays ?? 4);
  const targetQuantity = editing?.targetQuantity ?? 1;
  const targetUnit = editing?.targetUnit || 'count';
  const graceMinutes = editing?.graceMinutes || 0;
  const scheduleTimezone = editing?.scheduleTimezone || me()?.timeZone || 'UTC';
  const weekdays = [['S', 0], ['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6]];
  const { friendIds, mode: audienceMode, audienceIds } = habitAudience(editing, getState());
  const state = getState();
  const pauseList = editing?.pauseWindows?.length
    ? `<div class="pause-list">${editing.pauseWindows.map((pause) => `<small>Paused ${esc(pause.startDate)} to ${esc(pause.endDate)}${pause.reason ? ` · ${esc(pause.reason)}` : ''}</small>`).join('')}</div>`
    : '';
  const pauseForm = editMode ? `<section class="schedule-pause"><button class="pause-disclosure" type="button" data-toggle-habit-pause aria-expanded="false" aria-controls="habit-pause-panel"><span>Pause for travel or a break</span><svg class="pause-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${pauseList}<div id="habit-pause-panel" data-habit-pause-panel hidden><form id="pause-form" class="form"><div class="pause-date-grid"><label>From<input name="startDate" type="date" required></label><label>Through<input name="endDate" type="date" required></label></div><label>Note (optional)<input name="reason" maxlength="280" placeholder="Vacation, sick, deload…"></label><button class="btn full" ${busy ? 'disabled' : ''}>Add pause</button></form></div></section>` : '';
  const friendChoices = friendIds.map((friendId) => {
    const friend = member(friendId);
    return `<label class="friend-audience-option"><input type="checkbox" name="audienceIds" value="${esc(friendId)}" ${audienceIds.has(friendId) ? 'checked' : ''} ${audienceMode === 'selected_friends' ? '' : 'disabled'}><span><strong>${esc(friend?.name || 'Friend')}</strong><small>Can see proof and join the conversation</small></span></label>`;
  }).join('');
  const legacySquadIds = (editing?.squadIds || state?.circles?.map((circle) => circle.id) || []).join(',');
  const audienceChoices = `<fieldset class="friend-audience"><legend>Who can see this?</legend><p>Pick who gets the proof, reactions, and replies.</p><div class="audience-mode-grid"><label class="audience-mode-card"><input type="radio" name="audienceMode" value="all_friends" ${audienceMode === 'all_friends' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">👥</span><span><strong>All friends</strong><small>Everyone connected</small></span></label><label class="audience-mode-card"><input type="radio" name="audienceMode" value="selected_friends" ${audienceMode === 'selected_friends' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">◎</span><span><strong>Selected</strong><small>You choose who</small></span></label><label class="audience-mode-card"><input type="radio" name="audienceMode" value="only_me" ${audienceMode === 'only_me' ? 'checked' : ''}><span class="audience-mode-icon" aria-hidden="true">🔒</span><span><strong>Only me</strong><small>Keep it private</small></span></label></div><div class="friend-audience-list" data-friend-audience-list ${audienceMode === 'selected_friends' ? '' : 'hidden'}>${friendChoices || '<small class="settings-empty">Add a friend to share proof with them.</small>'}</div></fieldset><input type="hidden" name="squadIds" value="${esc(legacySquadIds)}">`;
  const archiveArea = editMode
    ? `<button class="btn danger-soft full archive-btn" type="button" data-archive-habit ${busy ? 'disabled' : ''}>Archive habit</button>`
    : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet ${editMode ? 'habit-edit-sheet' : ''}" role="dialog" aria-modal="true" aria-label="${editMode ? 'Edit habit' : 'Add habit'}" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>${editMode ? 'Edit habit' : 'Add a habit'}</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form">${editMode ? '' : `<div class="starter-templates"><span>Quick start</span>${starterTemplates.map((template, index) => `<button type="button" data-template="${index}">${template.emoji} ${esc(template.title)}</button>`).join('')}</div>`}<label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" value="${esc(title)}" required autofocus></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-pressed="${emoji === selectedEmoji}" class="emoji ${emoji === selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><fieldset class="schedule-fields"><legend>When does this count?</legend><label>Schedule<select name="scheduleFrequency"><option value="daily" ${scheduleFrequency === 'daily' ? 'selected' : ''}>Every day</option><option value="selected_weekdays" ${scheduleFrequency === 'selected_weekdays' ? 'selected' : ''}>Specific days</option><option value="times_per_week" ${scheduleFrequency === 'times_per_week' ? 'selected' : ''}>X times per week</option><option value="weekly" ${scheduleFrequency === 'weekly' ? 'selected' : ''}>Once a week</option></select></label><div data-weekly-target ${scheduleFrequency === 'times_per_week' ? '' : 'hidden'}><label>Days per week<select name="weeklyTargetDays" ${scheduleFrequency === 'times_per_week' ? '' : 'disabled'}>${[1, 2, 3, 4, 5, 6, 7].map((day) => `<option value="${day}" ${weeklyTargetDays === day ? 'selected' : ''}>${day} ${day === 1 ? 'day' : 'days'}</option>`).join('')}</select></label><small>Any distinct days count Monday–Sunday. Your first official week starts next Monday.</small></div><div data-schedule-weekdays ${['selected_weekdays', 'weekly'].includes(scheduleFrequency) ? '' : 'hidden'}><span class="field-label">Days</span><div class="weekday-row">${weekdays.map(([label, day]) => `<label title="${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}"><input type="checkbox" name="scheduleWeekdays" value="${day}" ${scheduleWeekdays.has(day) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><small>Pick the exact days. For once-a-week habits, the first picked day is the due day.</small></div><div class="form-grid"><label>Amount<input name="targetQuantity" type="number" min="0.01" step="any" value="${esc(targetQuantity)}" required></label><label>Unit<input name="targetUnit" maxlength="40" value="${esc(targetUnit)}" placeholder="pages, minutes" required></label></div><div class="form-grid"><label>Due time<input name="targetTime" type="time" value="${esc(targetTime)}"></label><label>Grace<select name="graceMinutes"><option value="0" ${graceMinutes === 0 ? 'selected' : ''}>None</option><option value="30" ${graceMinutes === 30 ? 'selected' : ''}>30 min</option><option value="60" ${graceMinutes === 60 ? 'selected' : ''}>1 hour</option><option value="120" ${graceMinutes === 120 ? 'selected' : ''}>2 hours</option></select></label></div><small>Timezone: ${esc(scheduleTimezone)}</small></fieldset><input type="hidden" name="scheduleTimezone" value="${esc(scheduleTimezone)}"><label>Proof<select name="proofMode"><option value="photo" ${proofMode === 'photo' ? 'selected' : ''}>Photo proof</option><option value="none" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option></select></label>${audienceChoices}${editMode ? '' : `<button class="btn primary full" ${busy ? 'disabled' : ''}>Add habit</button>`}</form>${editMode ? `<div class="habit-save-dock" data-habit-save-dock hidden><button class="btn primary full" type="submit" form="habit-form" ${busy ? 'disabled' : ''}>Save changes</button></div>` : ''}${pauseForm}<div class="habit-sheet-actions">${archiveArea}<button class="text-btn" type="button" data-cancel-habit ${busy ? 'disabled' : ''}>Cancel</button></div></section></div>`;
}

function settingsSheet() {
  if (!settingsSheetOpen) return '';
  const capability = getNotificationCapability(window);
  const state = getState();
  const preferences = state.notificationPreferences;
  const categoryLabels = {
    due_soon: { icon: '⏱', label: 'Due soon', description: 'A useful heads-up before the clock wins.' },
    streak_risk: { icon: '🔥', label: 'Streak at risk', description: 'Only when a streak is genuinely on the line.' },
    friend_activity: { icon: '👀', label: 'Friend check-ins', description: 'See when your people show up.' },
    nudge: { icon: '⚡', label: 'Nudges', description: 'A friend is calling you out.' },
    reaction: { icon: '👏', label: 'Reactions', description: 'Someone hyped your check-in.' },
    comment: { icon: '💬', label: 'Replies', description: 'Someone left a quick reply.' },
    challenge_progress: { icon: '🏆', label: 'Challenge progress', description: 'Meaningful squad challenge updates.' },
  };
  const categoryChoices = Object.entries(categoryLabels).map(([value, item]) => `<label class="notification-option"><span class="notification-option-icon" aria-hidden="true">${item.icon}</span><span><strong>${item.label}</strong><small>${item.description}</small></span><span class="switch-control notification-option-toggle"><input type="checkbox" name="category" value="${value}" ${preferences.categories[value] !== false ? 'checked' : ''}><span aria-hidden="true"></span></span></label>`).join('');
  const habitChoices = myHabits(state).map((habit) => `<label class="notification-option compact"><span class="notification-option-icon" aria-hidden="true">${esc(habit.emoji)}</span><span><strong>${esc(habit.title)}</strong><small>Personal reminder</small></span><span class="switch-control notification-option-toggle"><input type="checkbox" name="habitEnabled" value="${habit.id}" ${preferences.habitOverrides[habit.id] !== false ? 'checked' : ''}><span aria-hidden="true"></span></span></label>`).join('');
  const squadList = (state.circles || []).map((circle) => `<button type="button" class="settings-squad ${circle.id === state.circleId ? 'active' : ''}" data-select-squad="${circle.id}"><span><strong>${esc(circle.name)}</strong><small>${circle.role}${circle.id === state.circleId ? ' · active' : ''}</small></span><span>›</span></button>`).join('');
  const views = {
    menu: `<div class="settings-menu"><button type="button" data-settings-view="profile"><span class="settings-menu-icon">☺</span><span><strong>Profile & app</strong><small>Name, install help, account</small></span><b>›</b></button><button type="button" data-settings-view="appearance"><span class="settings-menu-icon">◐</span><span><strong>Appearance</strong><small>System, light, or dark</small></span><b>›</b></button><button type="button" data-settings-view="notifications"><span class="settings-menu-icon">◌</span><span><strong>Notifications</strong><small>Quiet hours and reminders</small></span><b>›</b></button><button type="button" data-settings-view="social"><span class="settings-menu-icon">↗</span><span><strong>Social & privacy</strong><small>Awards and Baton participation</small></span><b>›</b></button></div>`,
    appearance: `<section class="appearance-settings"><p class="sheet-copy">Pick what feels right. System follows your phone automatically.</p><div class="theme-choice" role="radiogroup" aria-label="App theme"><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'system'}" class="${currentThemeChoice() === 'system' ? 'active' : ''}" data-theme-choice="system"><span>◐</span><strong>System</strong></button><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'light'}" class="${currentThemeChoice() === 'light' ? 'active' : ''}" data-theme-choice="light"><span>☀</span><strong>Light</strong></button><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'dark'}" class="${currentThemeChoice() === 'dark' ? 'active' : ''}" data-theme-choice="dark"><span>☾</span><strong>Dark</strong></button></div></section>`,
    profile: `<form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="btn full">Save name</button></form><form id="username-form" class="form sheet-form username-form"><label>Username<div class="username-input-wrap"><span aria-hidden="true">@</span><input name="username" value="${esc(String(me().handle || '').replace(/^@/, ''))}" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._]{2,29}" autocapitalize="none" autocomplete="off" spellcheck="false" required></div><small>People can find you by this.</small></label><button class="btn full">Save username</button></form><div class="install-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Push works best from the installed app.</p></div><button class="text-btn danger" id="sign-out">Sign out</button>`,

    squads: `<section class="squad-manager"><div class="settings-title"><div><strong>Your squads</strong><p>Keep groups separate. Switching does not lose your place.</p></div><span>${(state.circles || []).length}</span></div><div class="settings-squad-list">${squadList}</div><details><summary>Create another squad</summary>${createCircleForm(false, true)}</details><details><summary>Join with a code</summary>${joinCircleForm(false, true)}</details></section>`,
    notifications: `<section class="notification-settings"><div class="notification-hero"><span class="notification-hero-icon" aria-hidden="true">🔔</span><div><strong>Stay in the loop, not glued to it.</strong><small>${capability.supported ? `Push is ${capability.permission}. You control what earns a buzz.` : 'Push is not supported here. Donezo still works.'}</small></div><button class="btn small-btn" type="button" id="notification-btn">${capability.permission === 'granted' ? 'Test' : 'Enable'}</button></div><form id="notification-preferences-form" class="form notification-form"><section class="notification-panel"><div class="notification-panel-head"><div><strong>Quiet hours</strong><small>Donezo shuts up while you sleep.</small></div><label class="switch-control"><input type="checkbox" name="quietHoursEnabled" ${preferences.quietHoursEnabled ? 'checked' : ''}><span aria-hidden="true"></span></label></div><div class="quiet-hours-grid"><label>From<input name="quietHoursStart" type="time" value="${esc(preferences.quietHoursStart)}"></label><label>Until<input name="quietHoursEnd" type="time" value="${esc(preferences.quietHoursEnd)}"></label></div><label class="timezone-field">Timezone<input name="timezone" value="${esc(preferences.timezone)}" maxlength="100" required><small>Uses your habit timezone so reminders land correctly.</small></label></section><section class="notification-panel"><div class="notification-panel-head"><div><strong>What can buzz you</strong><small>Keep only the stuff you would actually open.</small></div></div><div class="notification-options">${categoryChoices}</div></section>${habitChoices ? `<section class="notification-panel"><div class="notification-panel-head"><div><strong>Habit reminders</strong><small>Mute individual habits without muting Donezo.</small></div></div><div class="notification-options">${habitChoices}</div></section>` : ''}<button class="btn primary full" ${busy ? 'disabled' : ''}>Save notifications</button></form></section>`,
    social: `<form id="social-preferences-form" class="form settings-social-form"><label class="preference-check"><input type="checkbox" name="recapAwardsEnabled" ${me().awardOptOut ? '' : 'checked'}><span><strong>Named recap awards</strong><small>Let your friends include your name in weekly and monthly awards.</small></span></label><label class="preference-check"><input type="checkbox" name="batonEnabled" ${state.batonOptedOut ? '' : 'checked'}><span><strong>Friend Baton</strong><small>Friends can pass you the next turn. No penalty if it expires.</small></span></label><button class="btn full" ${busy ? 'disabled' : ''}>Save social settings</button></form>`,
  };
  const title = ({ menu: 'Settings', profile: 'Profile & app', appearance: 'Appearance', squads: 'Squads', notifications: 'Notifications', social: 'Social & privacy' })[settingsView] || 'Settings';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div>${settingsView === 'menu' ? '<p class="eyebrow">SETTINGS</p>' : '<button class="settings-back" type="button" data-settings-back>‹ Settings</button>'}<h2>${title}</h2></div><button class="icon-btn" type="button" data-close-settings aria-label="Close">×</button></div>${views[settingsView] || views.menu}</section></div>`;
}

function nudgeComposerSheet() {
  if (!nudgeComposerUserId) return '';
  const friend = member(nudgeComposerUserId);
  const quick = ['Lock in bro 😭', "Don't sell 💀", "Clock's ticking lil bro", 'You got this 🤝'];
  return `<div class="sheet-backdrop nudge-composer-layer" data-close-sheet><section class="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Nudge friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">NUDGE ${esc(friend?.name || 'FRIEND').toUpperCase()}</p><h2>Apply pressure ⚡</h2></div><button class="icon-btn" type="button" data-close-nudge aria-label="Close">×</button></div><div class="quick-nudges">${quick.map((message) => `<button type="button" data-nudge-copy="${esc(message)}">${esc(message)}</button>`).join('')}</div><form id="nudge-form" class="form sheet-form"><label>Message<textarea name="message" maxlength="140" rows="3" required>Lock in bro 😭</textarea></label><p class="privacy-note">Only ${esc(friend?.name || 'your friend')} sees it.</p><div class="char-hint">140 chars max. Be annoying responsibly.</div><button class="btn primary full" ${busy ? 'disabled' : ''}>Send nudge</button></form></section></div>`;
}

function nudgeInboxSheet() {
  if (!nudgeInboxOpen) return '';
  const updates = updatesList();
  const rows = updates.map((item) => {
    if (item.kind === 'notification') {
      const mark = ({ reaction: '👏', comment: '💬', due_soon: '⏱', streak_risk: '🔥', challenge_progress: '🏆' })[item.category] || '🔔';
      return `<article class="update-notification-row"><span class="update-notification-mark" aria-hidden="true">${mark}</span><span><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></span></article>`;
    }
    const actor = member(item.userId);
    if (item.kind === 'nudge') {
      return `<article class="inbox-nudge ${item.readAt ? 'read' : ''}"><div><strong>⚡ ${esc(actor?.name || 'Friend')}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></div>${item.readAt ? '<span>Seen</span>' : `<button class="btn small-btn" type="button" data-read-nudge="${item.sourceId}">Got it</button>`}</article>`;
    }
    const activity = item.activity;
    const detail = activity?.habitTitle ? `${activity.emoji || '✓'} ${activity.habitTitle}` : item.message;
    return `<button class="update-activity-row" type="button" data-friend-profile="${item.userId}"><span class="avatar">${esc(actor?.avatar || '?')}</span><span><strong>${esc(actor?.name || 'Friend')}</strong><p>${esc(detail)}</p><small>${esc(formatWhen(item.when))}</small></span></button>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet updates-sheet" role="dialog" aria-modal="true" aria-label="Updates" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">UPDATES</p><h2>${updates.length ? 'What happened' : 'All caught up'}</h2></div><button class="icon-btn" type="button" data-close-inbox aria-label="Close">×</button></div>${rows ? `<div class="inbox-list updates-list">${rows}</div>` : '<div class="empty compact-empty"><b>Quiet right now.</b><p>Nudges, activity, and notifications will show up here.</p></div>'}</section></div>`;
}

function inviteSheet() {
  if (!inviteSheetOpen) return '';
  return `<div class="sheet-backdrop" data-close-invite-backdrop><section class="sheet compact-sheet invite-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="Invite friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">INVITE FRIENDS</p><h2>Invite a friend</h2></div><button class="icon-btn" type="button" data-close-invite aria-label="Close">×</button></div><p class="invite-sheet-copy">Share a fresh private link every time. They choose whether to connect.</p><div class="invite-sheet-actions"><button class="btn primary full" type="button" data-share-invite>Share invite</button></div></section></div>`;
}

function addFriendSheet() {
  if (!addFriendSheetOpen) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet add-friend-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="Add a friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD A FRIEND</p><h2>Paste their link.</h2></div><button class="icon-btn" type="button" data-close-add-friend aria-label="Close">×</button></div><p class="sheet-copy">A full Donezo invite link or the raw invite code both work.</p>${inviteMessage ? `<div class="form-message" role="alert">${esc(inviteMessage)}</div>` : ''}<form id="join-friend-form" class="form sheet-form"><label>Invite link or code<input name="code" inputmode="text" autocomplete="one-time-code" autocapitalize="none" placeholder="Paste invite link or code" required autofocus></label><button class="btn primary full" type="submit">Add friend</button></form></section></div>`;
}

function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Friends</button>';
  if (person.relationship === 'outgoing') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Requested</button>';
  if (person.relationship === 'incoming') return `<button class="btn primary small-btn" type="button" data-people-accept="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Accept</button>`;
  return `<button class="btn primary small-btn" type="button" data-people-add="${esc(person.id)}">Add</button>`;
}

function peoplePersonRow(person) {
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  const mutualCopy = mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : '';
  const avatar = person.avatarUrl
    ? `<img src="${esc(person.avatarUrl)}" alt="">`
    : esc(person.avatar || String(person.name || '?').slice(0, 1).toUpperCase());
  return `<article class="people-discovery-row"><button class="people-discovery-identity" type="button" data-people-person="${esc(person.id)}"><span class="avatar">${avatar}</span><span class="people-discovery-meta"><strong>${esc(person.name || 'Donezo user')}</strong>${handle ? `<small>${esc(handle)}</small>` : ''}${mutualCopy ? `<small>${esc(mutualCopy)}</small>` : ''}</span></button>${peopleRelationshipAction(person)}</article>`;
}


function discoveryProfileSheet() {
  if (!discoveryProfilePerson) return '';
  const person = discoveryProfilePerson;
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  const mutualCopy = mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : 'No mutual friends yet';
  const avatar = person.avatarUrl
    ? `<img src="${esc(person.avatarUrl)}" alt="">`
    : esc(person.avatar || String(person.name || '?').slice(0, 1).toUpperCase());
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet people-sheet people-flow-sheet people-discovery-profile" role="dialog" aria-modal="true" aria-label="${esc(person.name || 'Donezo user')} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><button class="settings-back" type="button" data-people-discovery-back>‹ People</button><h2>${esc(person.name || 'Donezo user')}</h2></div><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div><div class="people-discovery-profile-body"><span class="avatar people-discovery-profile-avatar">${avatar}</span><strong>${esc(person.name || 'Donezo user')}</strong>${handle ? `<span>${esc(handle)}</span>` : ''}<small>${esc(mutualCopy)}</small><div class="people-discovery-profile-action">${peopleRelationshipAction(person)}</div></div></section></div>`;
}

function openPeoplePerson(person) {
  if (!person?.id) return;
  const alreadyFriend = person.relationship === 'friend' || friendList(getState()).some((friend) => friend.id === person.id);
  if (alreadyFriend) {
    discoveryProfilePerson = null;
    openFriendProfile(person.id);
    return;
  }
  discoveryProfilePerson = { ...person };
  refreshPeopleSheet();
}

function peopleSheet() {
  if (!peopleSheetOpen || friendProfileUserId || inviteSheetOpen) return '';
  if (discoveryProfilePerson) return discoveryProfileSheet();
  const state = getState();
  const normalizedQuery = peopleSearchQuery.trim().replace(/^@/, '').toLowerCase();
  const searching = normalizedQuery.length >= 2;
  const incoming = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId);
  const requestPeople = incoming.map((request) => {
    const profile = member(request.requesterId) || {};
    return {
      id: request.requesterId,
      name: profile.name || 'Donezo user',
      username: profile.username || String(profile.handle || '').replace(/^@/, ''),
      handle: profile.handle || (profile.username ? `@${profile.username}` : ''),
      avatar: profile.avatar || '?',
      avatarUrl: profile.avatarUrl || null,
      relationship: 'incoming',
      requestId: request.id,
      mutualCount: 0,
    };
  });
  const friends = friendList(state).filter((person) => person.id !== state.currentUserId).map((person) => ({
    ...person,
    username: person.username || String(person.handle || '').replace(/^@/, ''),
    relationship: 'friend',
    requestId: null,
    mutualCount: 0,
  }));
  const requestsSection = requestPeople.length
    ? `<section class="people-section"><div class="people-section-head"><h3>Requests</h3><span>${requestPeople.length}</span></div>${requestPeople.map(peoplePersonRow).join('')}</section>`
    : '';
  const suggestionsSection = peopleSuggestionsLoading
    ? '<section class="people-section"><div class="people-section-head"><h3>Suggested for you</h3></div><div class="people-search-loading">Finding people you may know…</div></section>'
    : peopleSuggestions.length
      ? `<section class="people-section"><div class="people-section-head"><h3>Suggested for you</h3></div>${peopleSuggestions.map(peoplePersonRow).join('')}</section>`
      : '';
  const friendsSection = friends.length
    ? `<section class="people-section"><div class="people-section-head"><h3>Friends</h3><span>${friends.length}</span></div>${friends.map(peoplePersonRow).join('')}</section>`
    : '';
  const defaultContent = `${requestsSection}${suggestionsSection}${friendsSection}<div class="people-growth-actions"><button class="btn full people-invite" type="button" data-invite-from-people ${friendInvitePreparing ? 'disabled aria-busy="true"' : ''}>${icon('userPlus')} ${friendInvitePreparing ? 'Preparing…' : 'Share invite'}</button><button class="text-btn people-invite-fallback" type="button" data-add-friend-from-people>Have an invite code?</button></div>`;
  const searchContent = peopleSearchLoading
    ? '<div class="people-search-loading">Searching…</div>'
    : peopleSearchResults.length
      ? `<div class="people-search-results">${peopleSearchResults.map(peoplePersonRow).join('')}</div>`
      : '<div class="empty compact-empty people-search-empty"><b>No people found.</b><p>Try their @username or display name.</p></div>';
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet people-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="People" data-sheet><div class="sheet-handle"></div><div class="sheet-head people-sheet-head"><div><p class="eyebrow">FRIENDS</p><h2>People</h2></div><div class="people-head-actions"><button class="icon-btn" type="button" data-invite-from-people aria-label="Share invite">${icon('userPlus')}</button><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div></div><div class="people-search-shell"><label class="people-search"><span aria-hidden="true">⌕</span><input name="peopleSearch" type="search" placeholder="Search people" value="${esc(peopleSearchQuery)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label></div><div class="people-discovery-body">${searching ? searchContent : defaultContent}</div></section></div>`;
}

function closePeopleSheet() {
  peopleSheetOpen = false;
  peopleSearchQuery = '';
  peopleSearchResults = [];
  peopleSearchLoading = false;
  peopleSuggestions = [];
  peopleSuggestionsLoading = false;
  discoveryProfilePerson = null;
  clearTimeout(peopleSearchDebounceTimer);
  peopleSearchDebounceTimer = null;
  peopleSearchRequestId += 1;
  peopleSuggestionsRequestId += 1;
  app.querySelector('.people-sheet')?.closest('.sheet-backdrop')?.remove();
}

function preservePeopleSearchFocus(callback) {
  const input = app.querySelector('.people-sheet [name="peopleSearch"]');
  const focused = document.activeElement === input;
  const start = input?.selectionStart ?? null;
  const end = input?.selectionEnd ?? null;
  callback();
  if (!focused) return;
  const next = app.querySelector('.people-sheet [name="peopleSearch"]');
  next?.focus({ preventScroll: true });
  if (start !== null && end !== null) next?.setSelectionRange?.(start, end);
}

function refreshPeopleSheet() {
  if (!peopleSheetOpen) return;
  const current = app.querySelector('.people-sheet')?.closest('.sheet-backdrop');
  if (!current) return;
  preservePeopleSearchFocus(() => {
    current.insertAdjacentHTML('afterend', peopleSheet());
    current.remove();
    bindPeopleSheetActions();
  });
}

function patchPeopleRequestBadge() {
  const state = getState();
  const count = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId).length;
  const button = app.querySelector('[data-people-open]');
  if (!button) return;
  button.querySelector('.people-request-badge')?.remove();
  if (!count) return;
  button.insertAdjacentHTML('beforeend', `<span class="people-request-badge">${count > 9 ? '9+' : count}</span>`);
}

function syncPeopleRelationship(userId, relationship, requestId = null) {
  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: requestId ?? person.requestId ?? null } : person;
  peopleSearchResults = peopleSearchResults.map(patch);
  peopleSuggestions = peopleSuggestions.map(patch);
  if (discoveryProfilePerson?.id === userId) discoveryProfilePerson = patch(discoveryProfilePerson);
}

async function handlePeopleAdd(userId) {
  if (!userId) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  syncPeopleRelationship(userId, 'outgoing');
  refreshPeopleSheet();
  try {
    const request = await repo.inviteFriend(userId);
    syncPeopleRelationship(userId, 'outgoing', request?.id || null);
    scheduleStateCacheWrite();
    notify('Friend request sent.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}

async function handlePeopleAccept(requestId, userId) {
  if (!requestId) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  if (userId) syncPeopleRelationship(userId, 'friend', null);
  refreshPeopleSheet();
  try {
    await repo.acceptFriend(requestId);
    if (userId) syncPeopleRelationship(userId, 'friend', null);
    scheduleStateCacheWrite();
    patchPeopleRequestBadge();
    notify('Friend added.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}

function queuePeopleSearch(rawQuery) {
  peopleSearchQuery = String(rawQuery || '');
  clearTimeout(peopleSearchDebounceTimer);
  const normalized = peopleSearchQuery.trim().replace(/^@/, '').toLowerCase();
  const requestId = ++peopleSearchRequestId;
  if (normalized.length < 2) {
    peopleSearchResults = [];
    peopleSearchLoading = false;
    refreshPeopleSheet();
    return;
  }
  peopleSearchLoading = true;
  refreshPeopleSheet();
  peopleSearchDebounceTimer = setTimeout(async () => {
    try {
      const results = await repo.searchPeople(normalized);
      if (requestId !== peopleSearchRequestId || !peopleSheetOpen) return;
      peopleSearchResults = results;
    } catch (error) {
      if (requestId !== peopleSearchRequestId) return;
      notify(readableError(error), 3600);
    } finally {
      if (requestId === peopleSearchRequestId && peopleSheetOpen) {
        peopleSearchLoading = false;
        refreshPeopleSheet();
      }
    }
  }, 250);
}

async function loadPeopleSuggestions() {
  const requestId = ++peopleSuggestionsRequestId;
  peopleSuggestionsLoading = true;
  refreshPeopleSheet();
  try {
    const suggestions = await repo.suggestPeople(10);
    if (requestId !== peopleSuggestionsRequestId || !peopleSheetOpen) return;
    peopleSuggestions = suggestions;
  } catch (error) {
    if (requestId !== peopleSuggestionsRequestId) return;
    peopleSuggestions = [];
    notify(readableError(error), 3600);
  } finally {
    if (requestId === peopleSuggestionsRequestId && peopleSheetOpen) {
      peopleSuggestionsLoading = false;
      refreshPeopleSheet();
    }
  }
}

function openAddFriendFromPeople() {
  closePeopleSheet();
  inviteMessage = '';
  addFriendSheetOpen = true;
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', addFriendSheet());
  const backdrop = app.querySelector('.add-friend-sheet')?.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target !== backdrop) return;
    addFriendSheetOpen = false;
    backdrop.remove();
  });
  app.querySelector('.add-friend-sheet [data-close-add-friend]')?.addEventListener('click', () => {
    addFriendSheetOpen = false;
    backdrop?.remove();
    openPeopleSheet();
  });
  app.querySelector('.add-friend-sheet #join-friend-form')?.addEventListener('submit', handleJoinCircle);
  bindSheetSwipeDismiss();
}

function bindPeopleSheetActions() {
  const sheet = app.querySelector('.people-sheet');
  if (!sheet) return;
  const backdrop = sheet.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closePeopleSheet();
  });
  sheet.querySelector('[data-close-people]')?.addEventListener('click', closePeopleSheet);
  sheet.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = handleShareInvite; });
  sheet.querySelector('[data-add-friend-from-people]')?.addEventListener('click', openAddFriendFromPeople);
  sheet.querySelector('[name="peopleSearch"]')?.addEventListener('input', (event) => queuePeopleSearch(event.target.value));
  sheet.querySelectorAll('[data-people-add]').forEach((element) => { element.onclick = () => handlePeopleAdd(element.dataset.peopleAdd); });
  sheet.querySelectorAll('[data-people-accept]').forEach((element) => { element.onclick = () => handlePeopleAccept(element.dataset.peopleAccept, element.dataset.peopleUser); });
  sheet.querySelector('[data-people-discovery-back]')?.addEventListener('click', () => {
    discoveryProfilePerson = null;
    refreshPeopleSheet();
  });
  sheet.querySelectorAll('[data-people-person]').forEach((element) => { element.onclick = () => {
    const rawFriend = friendList(getState()).find((item) => item.id === element.dataset.peoplePerson);
    const person = [...peopleSearchResults, ...peopleSuggestions].find((item) => item.id === element.dataset.peoplePerson)
      || (rawFriend ? { ...rawFriend, relationship: 'friend' } : null);
    openPeoplePerson(person);
  }; });
  bindSheetSwipeDismiss();
}

function openPeopleSheet() {
  if (peopleSheetOpen && app.querySelector('.people-sheet')) return;
  peopleSheetOpen = true;
  peopleSearchQuery = '';
  peopleSearchResults = [];
  peopleSearchLoading = false;
  peopleSuggestions = [];
  peopleSuggestionsLoading = false;
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', peopleSheet());
  bindPeopleSheetActions();
  void primeFriendInvite();
  void loadPeopleSuggestions();
}

function checkInUndoSheet() {
  if (!checkInUndoRequest) return '';
  const habit = getState()?.habits.find((item) => item.id === checkInUndoRequest.habitId);
  if (!habit) return '';
  return `<div class="sheet-backdrop checkin-undo-layer"><section class="sheet compact-sheet checkin-undo-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm check-in undo" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">CHECK-IN</p><h2>Undo this check-in?</h2></div><button class="icon-btn" type="button" data-cancel-check-in-undo aria-label="Keep check-in">×</button></div><p class="sheet-copy">This removes today’s completion for ${esc(habit.title)}. You can check it off again anytime.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-check-in-undo>Keep it done</button><button class="btn danger-soft" type="button" data-confirm-check-in-undo>Undo check-in</button></div></section></div>`;
}

function proofRejectSheet() {
  if (!proofRejectCheckInId) return '';
  const activity = activityList(getState()).find((item) => item.checkInId === proofRejectCheckInId);
  return `<div class="sheet-backdrop proof-reject-layer"><section class="sheet compact-sheet proof-reject-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm proof rejection" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PROOF CHECK</p><h2>Reject this proof?</h2></div><button class="icon-btn" type="button" data-cancel-reject aria-label="Cancel">×</button></div><p class="sheet-copy">Only reject it if the photo genuinely does not prove ${esc(activity?.habitTitle || 'the habit')}. Enough rejections can remove the check-in from streaks and League.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-reject>Keep proof</button><button class="btn danger-soft" type="button" data-confirm-reject="${proofRejectCheckInId}">Reject proof</button></div></section></div>`;
}

function commentSheet() {
  if (!commentCheckInId) return '';
  const state = getState();
  const activity = activityList(state).find((item) => item.checkInId === commentCheckInId);
  const comments = (state.comments || []).filter((item) => item.checkInId === commentCheckInId);
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet comment-sheet" role="dialog" aria-modal="true" aria-label="Replies" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">QUICK REPLIES</p><h2>${esc(activity?.emoji || '✓')} ${esc(activity?.habitTitle || 'Check-in')}</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><div class="comment-list">${comments.length ? comments.map((comment) => `<article class="comment-row"><button class="comment-profile" type="button" data-friend-profile="${comment.authorId}" aria-label="Open ${esc(member(comment.authorId)?.name || 'friend')} profile"><div class="avatar">${esc(member(comment.authorId)?.avatar || '?')}</div><span><strong>${comment.authorId === state.currentUserId ? 'You' : esc(member(comment.authorId)?.name || 'Friend')}</strong><small>${esc(formatWhen(comment.createdAt))}</small></span></button><p>${esc(comment.body)}</p>${comment.authorId === state.currentUserId ? `<button class="comment-delete" type="button" data-delete-comment="${comment.id}" aria-label="Delete reply">×</button>` : ''}</article>`).join('') : '<div class="empty compact-empty"><b>No replies yet.</b><p>Keep it short. This is hype, not group chat.</p></div>'}</div><form id="comment-form" class="comment-form"><input name="body" maxlength="180" required autocomplete="off" placeholder="Say something useful…" value="${commentRetryDraft?.checkInId === commentCheckInId ? esc(commentRetryDraft.body) : ''}"><button class="btn primary" ${busy ? 'disabled' : ''}>Send</button></form></section></div>`;
}


function closeCommentSheet() {
  commentCheckInId = null;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
}

function bindCommentSheetActions() {
  const sheet = app.querySelector('.comment-sheet');
  if (!sheet) return;
  const backdrop = sheet.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeCommentSheet();
  });
  sheet.querySelector('[data-close-social-sheet]')?.addEventListener('click', closeCommentSheet);
  sheet.querySelector('#comment-form')?.addEventListener('submit', handleCommentSubmit);
  sheet.querySelectorAll('[data-delete-comment]').forEach((element) => {
    element.onclick = () => handleDeleteComment(element.dataset.deleteComment);
  });
  sheet.querySelectorAll('[data-friend-profile]').forEach((element) => {
    element.onclick = () => openFriendProfile(element.dataset.friendProfile);
  });
  bindSheetSwipeDismiss();
}

function refreshCommentSheet() {
  if (!commentCheckInId) return;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', commentSheet());
  bindCommentSheetActions();
}

function openCommentSheet(checkInId) {
  if (!checkInId) return;
  commentCheckInId = checkInId;
  app.querySelector('.comment-sheet')?.closest('.sheet-backdrop')?.remove();
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', commentSheet());
  bindCommentSheetActions();
}

function batonSheet() {
  if (!batonSheetOpen) return '';
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const source = state.checkIns.filter((item) => item.userId === state.currentUserId && !item.invalid).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  const recipients = friendList(state).filter((person) => person.id !== state.currentUserId);
  if (!source || !recipients.length) return '';
  const mode = baton ? 'pass' : 'start';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet baton-sheet" role="dialog" aria-modal="true" aria-label="Pass the baton" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">SQUAD BATON</p><h2>Who goes next?</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><p class="sheet-copy">Your check-in starts the handoff. They get one turn, then pass it forward.</p><form id="baton-form" class="form sheet-form" data-mode="${mode}"><input type="hidden" name="sourceCheckInId" value="${esc(source.id)}"><label>Pass to<select name="recipientUserId" required>${recipients.map((person) => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${mode === 'pass' ? 'Pass baton' : 'Start baton'}</button></form></section></div>`;
}

function badgeCabinet() {
  if (!badgeCabinetOpen) return '';
  const earned = earnedBadges();
  const unlocked = new Map(earned.map((badge) => [badge.id, badge]));
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet badge-cabinet" role="dialog" aria-modal="true" aria-label="Milestone badges" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PERMANENT MILESTONES</p><h2>Your badges</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><p class="sheet-copy">Awards reset monthly. These do not.</p><div class="badge-grid">${BADGE_CATALOG.map((badge) => { const item = unlocked.get(badge.id); return `<article class="badge-tile ${item ? 'earned' : 'locked'}"><i aria-hidden="true">${item ? badgeIcon(badge.category) : '·'}</i><strong>${esc(badge.name)}</strong><p>${esc(badge.description)}</p><small>${item ? `Unlocked ${esc(item.earnedAt)}` : 'Locked'}</small></article>`; }).join('')}</div></section></div>`;
}

function wrappedSlide(screen, wrapped) {
  if (screen.kind === 'cover') return `<div class="wrapped-slide cover"><small>${esc(monthLabel(wrapped.period.month).toUpperCase())}</small><h2>Your friends showed up.</h2><p>Here is the month in five quick taps.</p></div>`;
  if (screen.kind === 'summary') return `<div class="wrapped-slide"><small>THE NUMBERS</small><h2>${screen.completionCount}</h2><p>valid check-ins from ${screen.activeParticipantCount} active ${screen.activeParticipantCount === 1 ? 'friend' : 'friends'}.</p><div class="wrapped-mini-stats"><span><b>${screen.proofCount}</b><small>proofs</small></span><span><b>${screen.participantCount}</b><small>friends</small></span></div></div>`;
  if (screen.kind === 'participants') return `<div class="wrapped-slide"><small>THE CREW</small><h2>${screen.activeParticipantIds.length} ${screen.activeParticipantIds.length === 1 ? 'friend checked' : 'friends checked'} in.</h2><div class="wrapped-people">${screen.activeParticipantIds.map((id) => `<span><b>${esc(member(id)?.avatar || '?')}</b>${esc(member(id)?.name || 'Friend')}</span>`).join('')}</div></div>`;
  if (screen.kind === 'awards') return `<div class="wrapped-slide"><small>MONTHLY AWARDS</small><h2>Okay, receipts are in.</h2><div class="wrapped-awards">${screen.awards.map((award) => `<article><b>${award.type === 'most_supportive' ? '🤝' : award.type === 'baton_carrier' ? '↗' : award.type === 'longest_streak' ? '🔥' : '🏆'}</b><span><strong>${esc(award.title)}</strong><small>${award.memberIds.map((id) => esc(member(id)?.name || 'Friend')).join(' + ')}</small></span></article>`).join('')}</div></div>`;
  return `<div class="wrapped-slide close"><small>${wrapped.period.partial ? 'MONTH IN PROGRESS' : 'THAT’S A WRAP'}</small><h2>${wrapped.period.partial ? 'Still cooking.' : 'Run it back.'}</h2><p>Badges stay forever. Awards start fresh next month.</p></div>`;
}

function monthlyWrappedSheet() {
  if (!wrappedOpen) return '';
  const wrapped = repo.getMonthlyWrapped(previousMonthKey(), { asOfDate: today(), timeZone: me()?.timeZone || 'UTC', recapOptOut: me()?.awardOptOut });
  const index = Math.min(wrappedIndex, wrapped.screens.length - 1);
  const screen = wrapped.screens[index];
  const winner = screen.kind === 'awards' && screen.awards.some((award) => award.memberIds.includes(me().id));
  return `<div class="wrapped-sheet" role="dialog" aria-modal="true" aria-label="Monthly Wrapped"><div class="wrapped-progress">${wrapped.screens.map((_, itemIndex) => `<i class="${itemIndex <= index ? 'active' : ''}"></i>`).join('')}</div><button class="wrapped-close" type="button" data-wrapped-close aria-label="Close Wrapped">×</button>${winner ? '<div class="wrapped-confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ''}${wrappedSlide(screen, wrapped)}<div class="wrapped-actions">${index > 0 ? '<button class="btn" type="button" data-wrapped-prev>Back</button>' : '<span></span>'}<button class="btn primary" type="button" ${index === wrapped.screens.length - 1 ? 'data-wrapped-close' : 'data-wrapped-next'}>${index === wrapped.screens.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
}

function friendProfileSheet() {
  if (!friendProfileUserId) return '';
  const person = member(friendProfileUserId);
  if (!person) return '';
  const state = getState();
  const habits = state.habits.filter((habit) => habit.ownerId === person.id && habit.active);
  const recent = activityList(state).filter((item) => item.userId === person.id);
  const otherActivity = recent.filter((item) => !item.proofPath);
  const score = weeklyCompletionScore(person.id, state.habits, state.checkIns, today());
  const memberDate = accountabilityDateForMember(person);
  const daily = dailyAccountabilitySummary(person.id, state.habits, state.checkIns, memberDate);
  const todayReceipts = daily.today.remaining.length
    ? `${daily.today.remaining.length} left: ${daily.today.remaining.map((habit) => `${habit.emoji || '○'} ${habit.title}`).join(', ')}`
    : daily.today.total ? 'All clear.' : 'No habits due.';
  const yesterdayReceipts = daily.yesterday.missed.length
    ? `Missed: ${daily.yesterday.missed.map((habit) => `${habit.emoji || '○'} ${habit.title}`).join(', ')}`
    : daily.yesterday.total ? 'Clean day.' : 'No habits were due.';
  const connectionRows = (friendConnections || []).map((connection) => {
    const detail = connection.mutualCount ? `${connection.mutualCount} mutual ${connection.mutualCount === 1 ? 'friend' : 'friends'}` : connection.handle || 'Friend of a friend';
    const action = connection.relationship === 'available'
      ? `<button class="btn primary small-btn" type="button" data-add-friend="${connection.id}" ${busy ? 'disabled' : ''}>Add</button>`
      : connection.relationship === 'incoming'
        ? `<button class="btn primary small-btn" type="button" data-accept-friend="${connection.requestId}" ${busy ? 'disabled' : ''}>Accept</button>`
        : connection.relationship === 'outgoing'
          ? '<button class="btn small-btn" type="button" disabled>Sent</button>'
          : '<span class="connection-state">Friends</span>';
    const knownFriend = member(connection.id);
    const identity = knownFriend
      ? `<button class="friend-connection-profile" type="button" data-friend-profile="${connection.id}" aria-label="Open ${esc(connection.name)} profile"><div class="avatar">${esc(connection.avatar || '?')}</div><span><strong>${esc(connection.name)}</strong><small>${esc(detail)}</small></span></button>`
      : `<div class="friend-connection-profile"><div class="avatar">${esc(connection.avatar || '?')}</div><span><strong>${esc(connection.name)}</strong><small>${esc(detail)}</small></span></div>`;
    return `<article class="friend-connection-row">${identity}${action}</article>`;
  }).join('');
  // The discovery RPC omits the viewer, who is already a direct friend.
  const connectionCount = (friendConnections || []).length + 1;
  const connections = person.id === me().id ? '' : `<details class="profile-connections"><summary><span><strong>${friendConnectionsLoading ? 'Friends' : `${connectionCount} ${connectionCount === 1 ? 'friend' : 'friends'}`}</strong><small>${friendConnectionsLoading ? 'Loading…' : 'Tap to view mutuals and add people'}</small></span><b aria-hidden="true">›</b></summary><div class="profile-connections-list">${friendConnectionsLoading ? '<p class="profile-connection-state">Loading friends…</p>' : connectionRows || '<p class="profile-connection-state">No other friends to show yet.</p>'}</div></details>`;
  const socialActions = person.id === me().id ? '' : `<div class="friend-profile-actions"><button class="btn primary full" data-nudge="${person.id}">Send a nudge</button>${typeof repo?.removeFriend === 'function' ? `<button class="text-btn danger" type="button" data-remove-friend="${person.id}" data-remove-friend-name="${esc(person.name)}">Remove friend</button>` : ''}</div>`;
  return `<div class="sheet-backdrop" data-close-friend-profile-backdrop><section class="sheet compact-sheet friend-profile-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="${esc(person.name)} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div class="friend-profile-title"><div class="avatar">${esc(person.avatar)}</div><div><h2>${esc(person.name)}</h2><p>${score.percent}% this week · 🔥 ${person.currentStreak}</p></div></div><button class="icon-btn" type="button" data-close-friend-profile aria-label="Close profile">×</button></div>${connections}<div class="profile-daily"><article><strong>Today · ${daily.today.completed}/${daily.today.total}</strong><p>${esc(todayReceipts)}</p></article><article class="${daily.yesterday.missed.length ? 'missed' : ''}"><strong>Yesterday · ${daily.yesterday.completed}/${daily.yesterday.total}</strong><p>${esc(yesterdayReceipts)}</p></article></div><div class="profile-habits"><strong>Active habits</strong>${habits.length ? habits.map((habit) => `<span>${esc(habit.emoji)} ${esc(habit.title)}</span>`).join('') : '<p>No shared habits right now.</p>'}</div><section class="profile-proofs"><strong>Proof history</strong>${personProofCarousel(person.id, recent)}</section><section class="profile-recent"><strong>Other activity</strong><div class="profile-activity-list">${otherActivity.length ? otherActivity.map((item) => activityCard(item)).join('') : '<p>No other activity yet.</p>'}</div></section>${socialActions}</section></div>`;
}

function recoverySheet() {
  if (!recoveryHabitId) return '';
  const item = missedHabits().find((habit) => habit.id === recoveryHabitId) || getState().habits.find((habit) => habit.id === recoveryHabitId);
  if (!item) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet recovery-sheet" role="dialog" aria-modal="true" aria-label="Recover habit" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><span class="eyebrow">BOUNCE BACK</span><h2>${esc(item.emoji)} ${esc(item.title)}</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><p class="sheet-copy">Yesterday still counts as a miss. Pick the next useful move.</p><form id="recovery-form" class="form sheet-form"><input type="hidden" name="missedDate" value="${esc(item.missedDate || shiftDate(today(), -1))}"><label>Next move<select name="action"><option value="recover_today">Recover today</option><option value="adjust_habit">Adjust this habit</option><option value="pause_habit">Pause for now</option><option value="ask_support">Ask the squad for support</option></select></label><label>Optional note<textarea name="reflection" maxlength="280" rows="3" placeholder="What got in the way?"></textarea></label><label class="inline-check"><input type="checkbox" name="share"> Let the squad encourage me</label><button class="btn primary full">Save comeback</button></form></section></div>`;
}

function challengeSheet() {
  if (!challengeSheetOpen) return '';
  const period = weekBounds();
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet challenge-sheet" role="dialog" aria-modal="true" aria-label="Start weekly challenge" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><span class="eyebrow">SQUAD GOAL</span><h2>One challenge. Keep it clear.</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><form id="challenge-form" class="form sheet-form"><label>Challenge<select name="kind"><option value="completion_percent">Group completion percent</option><option value="total_completions">Total check-ins</option><option value="no_consecutive_miss">No back-to-back misses</option></select></label><label>Name<input name="title" maxlength="80" value="Hit 80% together" required></label><label>Target<input name="target" type="number" min="1" max="10000" value="80" required></label><input type="hidden" name="startsOn" value="${period.start}"><input type="hidden" name="endsOn" value="${period.end}"><button class="btn primary full">Start challenge</button></form></section></div>`;
}

function stakeSheet() {
  if (!stakeSheetOpen) return '';
  const period = weekBounds();
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet stake-sheet" role="dialog" aria-modal="true" aria-label="Propose friendly stake" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><span class="eyebrow">FRIENDLY STAKE</span><h2>Make showing up matter.</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><p class="sheet-copy">Everyone opts in. No money, betting, or retroactive rule changes.</p><form id="stake-form" class="form sheet-form"><label>Rule<select name="rule"><option value="all_succeed">Everyone succeeds</option><option value="winner">Winner gets the reward</option><option value="loser">Lowest score takes the consequence</option></select></label><label>Reward<input name="reward" maxlength="140" placeholder="Pick Friday dinner"></label><label>Consequence<input name="consequence" maxlength="140" placeholder="Post a funny selfie"></label><input type="hidden" name="startsOn" value="${period.start}"><input type="hidden" name="endsOn" value="${period.end}"><button class="btn primary full">Propose to squad</button></form></section></div>`;
}

function dualProofSheet() {
  if (!dualProof || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === dualProof.habitId);
  if (!habit) return '';
  const mainStep = dualProof.phase === 'main';
  const mode = dualProof.mode === 'dual' ? 'dual' : 'single';
  const title = mainStep ? (mode === 'dual' ? 'Take main photo' : 'Take your proof') : 'Take your selfie';
  const fallbackAttr = mainStep ? 'data-dual-fallback-main' : 'data-dual-fallback-selfie';
  const modeSwitch = mainStep ? `<div class="camera-mode-switch" role="group" aria-label="Photo mode"><button class="${mode === 'single' ? 'active' : ''}" type="button" data-camera-mode="single" aria-pressed="${mode === 'single'}">Single</button><button class="${mode === 'dual' ? 'active' : ''}" type="button" data-camera-mode="dual" aria-pressed="${mode === 'dual'}">Dual</button></div>` : '';
  return `<div class="sheet-backdrop"><section class="sheet dual-proof-sheet" role="dialog" aria-modal="true" aria-label="Photo proof camera" data-sheet><div class="sheet-handle"></div><div class="sheet-head camera-sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-dual-cancel aria-label="Cancel proof">×</button></div>${modeSwitch}<div class="dual-camera-frame"><video data-dual-camera autoplay playsinline muted></video><div class="dual-camera-loading">Starting camera…</div></div>${dualProof.error ? `<div class="proof-error" role="alert"><p>${esc(dualProof.error)}</p></div>` : ''}<button class="btn primary full camera-capture-btn" type="button" data-dual-capture>${mainStep ? 'Capture' : 'Capture selfie'}</button><button class="camera-quality-fallback" type="button" ${fallbackAttr}><span class="camera-quality-icon" aria-hidden="true">📷</span><strong>Use iPhone camera for better quality</strong><span class="camera-quality-chevron" aria-hidden="true">›</span></button></section></div>`;
}

function proofSourceSheet() {
  if (!proofHabit || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofHabit);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Take a photo, pick one from your library, or paste a screenshot. Large photos are compressed automatically.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-donezo-camera>Use Donezo camera</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button><button class="btn full" type="button" data-proof-paste>Paste copied photo</button></section></div>`;
}

function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  const cameraSession = dualProof?.habitId === habit.id && (dualProof?.mode === 'single' || Boolean(dualProof?.selfieFile));
  const dual = cameraSession && dualProof?.mode === 'dual';
  const replaceActions = dual
    ? `<div class="proof-review-actions"><button class="btn" type="button" data-dual-retake-main ${uploading ? 'disabled' : ''}>Retake proof</button><button class="btn" type="button" data-dual-retake-selfie ${uploading ? 'disabled' : ''}>Retake selfie</button></div>`
    : cameraSession
      ? `<div class="proof-review-actions"><button class="btn" type="button" data-camera-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose from library</button></div>`
      : `<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button></div><button class="btn full proof-add-selfie-btn" type="button" data-proof-add-selfie ${uploading ? 'disabled' : ''}>Add selfie · make it Dual</button>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}${replaceActions}<div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : proofReview.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}

function stopDualCamera() {
  dualCameraRequestId += 1;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
}

function openNativeCameraFallback(input) {
  input?.click();
}

function clearDualProof() {
  stopDualCamera();
  dualProof = null;
}

async function startDualCameraIfNeeded() {
  if (!dualProof || proofReview || !['main', 'selfie'].includes(dualProof.phase)) return;
  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraSupported()) return;
  const liveTrack = dualCameraStream?.getVideoTracks?.().find((track) => track.readyState === 'live');
  if (liveTrack) {
    video.srcObject = dualCameraStream;
    await video.play?.().catch(() => {});
    video.parentElement?.querySelector('.dual-camera-loading')?.remove();
    return;
  }
  const requestId = ++dualCameraRequestId;
  stopMediaStream(dualCameraStream);
  dualCameraStream = null;
  try {
    const facing = dualProof.phase === 'main' ? 'environment' : 'user';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
        aspectRatio: { ideal: 4 / 3 },
      },
      audio: false,
    });
    if (requestId !== dualCameraRequestId || !dualProof || !video.isConnected) {
      stopMediaStream(stream);
      return;
    }
    dualCameraStream = stream;
    video.srcObject = stream;
    await video.play?.().catch(() => {});
    video.parentElement?.querySelector('.dual-camera-loading')?.remove();
  } catch (error) {
    if (requestId !== dualCameraRequestId || !dualProof) return;
    dualProof = transitionDualProof(dualProof, { type: 'failed', error: 'Camera access failed. Use the phone camera fallback below.' });
    render();
  }
}

async function finishDualSelection(file, side) {
  if (!dualProof || !file) return;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return;
  }
  const prepared = file.size > MAX_PROOF_BYTES ? await compressProofFile(file) : file;
  dualProof = transitionDualProof(dualProof, { type: side === 'main' ? 'main_selected' : 'selfie_selected', file: prepared });
  stopDualCamera();
  if (dualProof.phase === 'review') {
    try {
      const output = dualProof.mode === 'dual'
        ? await composeDualProof(dualProof.mainFile, dualProof.selfieFile)
        : dualProof.mainFile;
      if (!output) throw new Error('Take a proof photo first');
      const previewUrl = URL.createObjectURL(output);
      if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
      proofReview = createProofReviewState({ file: output, habitId: dualProof.habitId, previewUrl });
    } catch (error) {
      dualProof = transitionDualProof(dualProof, { type: 'failed', error: readableError(error) });
    }
  }
  render();
}

async function captureDualCamera() {
  if (!dualProof) return;
  const video = app.querySelector('[data-dual-camera]');
  if (!video || !dualCameraStream) {
    (dualProof.phase === 'main' ? dualProofMainInput : proofSelfieInput)?.click();
    return;
  }
  try {
    const side = dualProof.phase;
    const file = await captureVideoFrame(video, { facing: side === 'main' ? 'environment' : 'user' });
    await finishDualSelection(file, side);
  } catch (error) {
    dualProof = transitionDualProof(dualProof, { type: 'failed', error: readableError(error) });
    render();
  }
}

function clearProofReview() {
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = null;
}

function dismissProofReview() {
  clearProofReview();
  proofHabit = null;
  clearDualProof();
  render();
}

function chooseProofInput(input) {
  if (!proofHabit && proofReview?.habitId) proofHabit = proofReview.habitId;
  input?.click();
}

function replaceProofSelection(input) {
  if (!proofReview) return;
  proofHabit = proofReview.habitId;
  input?.click();
}

function acceptProofFile(file) {
  if (!file) return false;
  const habitId = proofHabit || proofReview?.habitId;
  if (!habitId) return false;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return false;
  }
  const previewUrl = URL.createObjectURL(file);
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = createProofReviewState({ file, habitId, previewUrl });
  proofHabit = null;
  render();
  return true;
}

async function handleProofFileSelection(input) {
  const file = input.files?.[0];
  input.value = '';
  await prepareProofFile(file);
}

async function prepareProofFile(file) {
  if (!file) return false;
  const habitId = proofHabit || proofReview?.habitId;
  if (!habitId) return false;
  const preparationId = ++proofPreparationId;
  try {
    if (file.size > MAX_PROOF_BYTES) notify('Compressing large photo…', 5000);
    const prepared = await compressProofFile(file);
    const currentHabitId = proofHabit || proofReview?.habitId;
    if (preparationId !== proofPreparationId || currentHabitId !== habitId) return false;
    if (prepared !== file) notify(`Photo compressed to ${formatProofFileSize(prepared.size)}`, 3200);
    return acceptProofFile(prepared);
  } catch (error) {
    const currentHabitId = proofHabit || proofReview?.habitId;
    if (preparationId === proofPreparationId && currentHabitId === habitId) notify(readableError(error), 4200);
    return false;
  }
}

async function handlePasteProof() {
  try {
    const file = await readClipboardImage(navigator.clipboard);
    await prepareProofFile(file);
  } catch (error) {
    const blocked = error?.name === 'NotAllowedError';
    notify(blocked
      ? 'Clipboard access was blocked. Allow it, or choose the photo from your library.'
      : readableError(error), 4200);
  }
}

async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  await refreshCoordinator?.waitForIdle();
  if (busy || proofReview !== review) return;
  const habit = getState().habits.find((item) => item.id === review.habitId);
  if (!habit) return;
  busy = true;
  proofReview = transitionProofReview(review, { type: 'uploading' });
  render();
  try {
    const checkInDate = today();
    await repo.completeWithProof(review.habitId, checkInDate, review.file);
    if (proofReview?.previewUrl === review.previewUrl) clearProofReview();
    proofHabit = null;
    clearDualProof();
    notify(`Proof saved · ${habit.title} 🧾`, 5000, { action: { label: 'Undo', onClick: () => handleUndoCheckIn(review.habitId, checkInDate) } });
    haptic(35);
  } catch (error) {
    if (proofReview?.previewUrl === review.previewUrl) {
      proofReview = transitionProofReview(proofReview, { type: 'failed', error: readableError(error) });
    }
  } finally {
    busy = false;
    render();
  }
}



async function loadProofThumbnail(element) {
  const path = element.dataset.proofImage;
  if (!path || !element.isConnected) return;
  try {
    let url = proofThumbnailUrls.get(path);
    if (!url) {
      url = await repo.getProofUrl(path);
      proofThumbnailUrls.set(path, url);
    }
    if (!element.isConnected || element.dataset.proofImage !== path) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      proofThumbnailUrls.delete(path);
      if (element.isConnected) element.innerHTML = '<span aria-hidden="true">📷</span><small>Tap to open</small>';
    });
    element.replaceChildren(image);
  } catch {
    if (element.isConnected) element.innerHTML = '<span aria-hidden="true">📷</span><small>Tap to open</small>';
  }
}

function bindProofThumbnails() {
  const thumbnails = [...app.querySelectorAll('[data-proof-image]')];
  if (!thumbnails.length) return;
  if (!('IntersectionObserver' in window)) {
    thumbnails.forEach(loadProofThumbnail);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadProofThumbnail(entry.target);
    });
  }, { rootMargin: '160px 0px' });
  thumbnails.forEach((element) => observer.observe(element));
}

function bindProofActions() {
  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });
  app.querySelectorAll('[data-proof-donezo-camera]').forEach((element) => { element.onclick = () => {
    if (!proofHabit) return;
    dualProof = createDualProofState(proofHabit, 'single');
    proofHabit = null;
    render();
  }; });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
  app.querySelectorAll('[data-proof-paste]').forEach((element) => { element.onclick = handlePasteProof; });
  app.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { proofHabit = null; render(); }; });
  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => replaceProofSelection(proofInput); });
  app.querySelectorAll('[data-proof-add-selfie]').forEach((element) => { element.onclick = () => {
    if (!proofReview) return;
    const habitId = proofReview.habitId;
    const mainFile = proofReview.file;
    dualProof = { ...createDualProofState(habitId, 'dual'), phase: 'selfie', mainFile };
    proofSelfieInput?.click();
  }; });
  app.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => {
    if (dualProof?.habitId === proofReview?.habitId) clearDualProof();
    replaceProofSelection(proofGalleryInput);
  }; });
  app.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  app.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  bindProofThumbnails();
  void startDualCameraIfNeeded();
}

async function openFriendProfile(userId) {
  if (!userId) return;
  friendProfileReturnTab = tab;
  commentCheckInId = null;
  nudgeInboxOpen = false;
  friendProfileUserId = userId;
  friendConnections = null;
  friendConnectionsLoading = userId !== getState()?.currentUserId && typeof repo?.loadFriendConnections === 'function';
  const requestId = ++friendConnectionsRequestId;
  render();
  if (!friendConnectionsLoading) return;
  try {
    const connections = await repo.loadFriendConnections(userId);
    if (requestId !== friendConnectionsRequestId || friendProfileUserId !== userId) return;
    friendConnections = connections;
  } catch (error) {
    if (requestId !== friendConnectionsRequestId) return;
    friendConnections = [];
    notify(readableError(error), 3600);
  } finally {
    if (requestId === friendConnectionsRequestId && friendProfileUserId === userId) {
      friendConnectionsLoading = false;
      renderPreservingScroll();
    }
  }
}

async function reloadOpenFriendConnections() {
  const userId = friendProfileUserId;
  if (!userId || userId === getState()?.currentUserId || typeof repo?.loadFriendConnections !== 'function') return;
  const requestId = ++friendConnectionsRequestId;
  friendConnectionsLoading = true;
  renderPreservingScroll();
  try {
    const connections = await repo.loadFriendConnections(userId);
    if (requestId === friendConnectionsRequestId && friendProfileUserId === userId) friendConnections = connections;
  } catch (error) {
    if (requestId === friendConnectionsRequestId) notify(readableError(error), 3600);
  } finally {
    if (requestId === friendConnectionsRequestId && friendProfileUserId === userId) {
      friendConnectionsLoading = false;
      renderPreservingScroll();
    }
  }
}

function render() {
  if (!session) {
    app.innerHTML = authScreen();
    app.querySelector('#auth-form')?.addEventListener('submit', handleAuth);
    app.querySelector('#auth-mode')?.addEventListener('click', () => {
      authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in';
      authMessage = '';
      render();
    });
    bindInviteActions();
    return;
  }
  const state = getState();
  if ((createdFriendInvite || createdCircleInvite) && state?.circleId) {
    app.innerHTML = creatorInviteScreen();
    bindInviteActions();
    return;
  }
  const hasFriendsWorkspace = Array.isArray(state?.friends) || Array.isArray(state?.activities);
  if (!state?.circleId && !hasFriendsWorkspace) {
    app.innerHTML = onboardingScreen();
    app.querySelector('#create-circle-form')?.addEventListener('submit', handleCreateCircle);
    app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);
    app.querySelector('#join-friend-form')?.addEventListener('submit', handleJoinCircle);
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
    bindInviteActions();
    return;
  }
  const screens = { today: todayScreen, friends: friendsScreen, league: leagueScreen, me: meScreen };
  app.innerHTML = `<div class="app-shell">${topbar()}${offlineIndicator()}${mutationIndicator()}<main class="content-scroll" id="content-scroll">${screens[tab]()}</main>${pwaUpdateBanner()}${notificationOptInBanner()}${nav()}${habitSheet()}${settingsSheet()}${nudgeComposerSheet()}${nudgeInboxSheet()}${peopleSheet()}${inviteSheet()}${addFriendSheet()}${checkInUndoSheet()}${proofRejectSheet()}${commentSheet()}${batonSheet()}${challengeInfoSheet()}${badgeCabinet()}${monthlyWrappedSheet()}${friendProfileSheet()}${recoverySheet()}${challengeSheet()}${stakeSheet()}${proofSourceSheet()}${dualProofSheet()}${proofReviewSheet()}</div>`;
  const contentScroller = app.querySelector('#content-scroll');
  if (contentScroller) {
    contentScroller.scrollTop = screenScroll[tab] || 0;
    contentScroller.onscroll = () => { screenScroll[tab] = contentScroller.scrollTop; };
  }
  app.querySelector('[data-checkin-action]')?.addEventListener('click', openCheckInAction);
  app.querySelectorAll('[data-tab]').forEach((element) => { element.onclick = () => {
    if (contentScroller) screenScroll[tab] = contentScroller.scrollTop;
    setActiveTab(element.dataset.tab);
    closeSheets();
    render();
    restoreScreenScroll();
  }; });
  app.querySelector('[data-squad-switcher]')?.addEventListener('change', (event) => handleSquadSelect(event.target.value));
  app.querySelectorAll('[data-friends]').forEach((element) => { element.onclick = () => { setActiveTab('friends'); closeSheets(); render(); }; });
  app.querySelectorAll('[data-select-squad]').forEach((element) => { element.onclick = () => handleSquadSelect(element.dataset.selectSquad); });
  app.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { dualProof = createDualProofState(element.dataset.quickProof, 'single'); proofHabit = null; render(); }; });
  app.querySelectorAll('[data-reaction]').forEach((element) => { element.onclick = () => handleReaction(element.dataset.reaction, element.dataset.reactionEmoji); });
  app.querySelectorAll('[data-comment-open]').forEach((element) => { element.onclick = () => openCommentSheet(element.dataset.commentOpen); });
  app.querySelectorAll('[data-delete-comment]').forEach((element) => { element.onclick = () => handleDeleteComment(element.dataset.deleteComment); });
  app.querySelectorAll('[data-baton-open], [data-pass-baton]').forEach((element) => { element.onclick = () => { challengeInfoOpen = false; batonSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-baton-checkin], [data-empty-checkin]').forEach((element) => { element.onclick = openCheckInAction; });
  app.querySelectorAll('[data-invite-from-baton]').forEach((element) => { element.onclick = () => { inviteSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-badge-cabinet]').forEach((element) => { element.onclick = () => { badgeCabinetOpen = true; render(); }; });
  app.querySelectorAll('[data-wrapped-open]').forEach((element) => { element.onclick = () => { wrappedOpen = true; wrappedIndex = 0; render(); }; });
  app.querySelectorAll('[data-wrapped-next]').forEach((element) => { element.onclick = () => { wrappedIndex += 1; render(); }; });
  app.querySelectorAll('[data-wrapped-prev]').forEach((element) => { element.onclick = () => { wrappedIndex = Math.max(0, wrappedIndex - 1); render(); }; });
  app.querySelectorAll('[data-wrapped-close]').forEach((element) => { element.onclick = () => { wrappedOpen = false; wrappedIndex = 0; render(); }; });
  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = openPeopleSheet; });
  app.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = handleShareInvite; });
  app.querySelectorAll('[data-add-friend-from-people]').forEach((element) => { element.onclick = () => { peopleSheetOpen = false; inviteMessage = ''; addFriendSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-add-friend-open]').forEach((element) => { element.onclick = () => { inviteMessage = ''; addFriendSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-friend-profile]').forEach((element) => { element.onclick = () => openFriendProfile(element.dataset.friendProfile); });
  app.querySelectorAll('[data-add-friend]').forEach((element) => { element.onclick = async () => {
    const added = await runMutation(() => repo.inviteFriend(element.dataset.addFriend), 'Friend request sent.');
    if (added) await reloadOpenFriendConnections();
  }; });
  app.querySelectorAll('[data-accept-friend]').forEach((element) => { element.onclick = async () => {
    const accepted = await runMutation(() => repo.acceptFriend(element.dataset.acceptFriend), 'Friend added.');
    if (accepted && friendProfileUserId) await reloadOpenFriendConnections();
  }; });
  app.querySelectorAll('[data-remove-friend]').forEach((element) => { element.onclick = async () => {
    const friendId = element.dataset.removeFriend;
    const friendName = element.dataset.removeFriendName || 'this friend';
    if (!window.confirm(`Remove ${friendName} from Friends? Proofs already shared stay visible.`)) return;
    const removed = await runMutation(() => repo.removeFriend(friendId), `${friendName} removed from Friends.`);
    if (removed) {
      friendProfileUserId = null;
      friendConnectionsRequestId += 1;
      friendConnections = null;
      friendConnectionsLoading = false;
      peopleSheetOpen = friendProfileReturnTab === 'friends';
      render();
    }
  }; });
  app.querySelectorAll('[data-recover-habit]').forEach((element) => { element.onclick = () => { recoveryHabitId = element.dataset.recoverHabit; render(); }; });
  app.querySelectorAll('[data-challenge]').forEach((element) => { element.onclick = () => { challengeInfoOpen = false; challengeSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-challenge-info]').forEach((element) => { element.onclick = () => { challengeInfoOpen = true; render(); }; });
  app.querySelectorAll('[data-stake]').forEach((element) => { element.onclick = () => { stakeSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-stake-response]').forEach((element) => { element.onclick = () => handleStakeResponse(element.dataset.stakeId, element.dataset.stakeResponse); });
  app.querySelectorAll('[data-resolve-stake]').forEach((element) => { element.onclick = () => handleStakeResolve(element.dataset.resolveStake); });
  app.querySelectorAll('[data-load-more]').forEach((element) => { element.onclick = () => { feedLimit += 12; renderPreservingScroll(); }; });
  app.querySelectorAll('[data-share-recap]').forEach((element) => { element.onclick = handleShareRecap; });
  app.querySelectorAll('[data-apply-update]').forEach((element) => { element.onclick = handleApplyPwaUpdate; });
  app.querySelectorAll('[data-enable-notifications]').forEach((element) => { element.onclick = handleNotifications; });
  app.querySelectorAll('[data-dismiss-notification-prompt]').forEach((element) => { element.onclick = () => { localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, '1'); render(); }; });
  app.querySelectorAll('[data-activation-next]').forEach((element) => { element.onclick = () => handleActivationNext(Number(element.dataset.activationNext)); });
  app.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => { nudgeComposerUserId = element.dataset.nudge; render(); }; });
  app.querySelectorAll('[data-request-reject]').forEach((element) => { element.onclick = () => {
    const activity = activityList(getState()).find((item) => item.checkInId === element.dataset.requestReject);
    if (activity?.userDownvoted) handleDownvote(element.dataset.requestReject);
    else { proofRejectCheckInId = element.dataset.requestReject; render(); }
  }; });
  app.querySelector('[data-confirm-check-in-undo]')?.addEventListener('click', () => { const request = checkInUndoRequest; checkInUndoRequest = null; if (request) handleUndoCheckIn(request.habitId, request.date); });
  app.querySelectorAll('[data-cancel-check-in-undo]').forEach((element) => { element.onclick = () => { checkInUndoRequest = null; render(); }; });
  app.querySelector('[data-confirm-reject]')?.addEventListener('click', () => { const id = proofRejectCheckInId; proofRejectCheckInId = null; handleDownvote(id); });
  app.querySelectorAll('[data-cancel-reject]').forEach((element) => { element.onclick = () => { proofRejectCheckInId = null; render(); }; });
  app.querySelectorAll('[data-redo-checkin]').forEach((element) => { element.onclick = () => handleRedoProof(element.dataset.redoCheckin); });
  app.querySelectorAll('[data-read-nudge]').forEach((element) => { element.onclick = () => handleReadNudge(element.dataset.readNudge); });
  app.querySelectorAll('[data-emoji]').forEach((element) => { element.onclick = () => {
    selectedEmoji = element.dataset.emoji;
    app.querySelectorAll('[data-emoji]').forEach((button) => {
      const selected = button.dataset.emoji === selectedEmoji;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    markHabitDirty();
  }; });
  app.querySelectorAll('[data-template]').forEach((element) => { element.onclick = () => {
    const template = starterTemplates[Number(element.dataset.template)];
    const form = app.querySelector('#habit-form');
    if (!template || !form) return;
    form.elements.title.value = template.title;
    form.elements.targetTime.value = template.targetTime;
    selectedEmoji = template.emoji;
    app.querySelectorAll('[data-emoji]').forEach((button) => {
      const selected = button.dataset.emoji === selectedEmoji;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }; });
  app.querySelectorAll('[data-nudge-copy]').forEach((element) => { element.onclick = () => { const textarea = app.querySelector('#nudge-form textarea'); if (textarea) textarea.value = element.dataset.nudgeCopy; }; });
  app.querySelectorAll('[data-settings]').forEach((element) => { element.onclick = () => { settingsView = 'menu'; settingsSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-settings-view]').forEach((element) => { element.onclick = () => { settingsView = element.dataset.settingsView; render(); }; });
  app.querySelectorAll('[data-theme-choice]').forEach((element) => { element.onclick = () => { applyTheme(element.dataset.themeChoice); render(); }; });
  app.querySelectorAll('[data-settings-back]').forEach((element) => { element.onclick = () => { settingsView = 'menu'; render(); }; });
  app.querySelectorAll('[data-nudge-inbox]').forEach((element) => { element.onclick = () => { void openUpdatesCenter(); }; });
  app.querySelectorAll('[data-home]').forEach((element) => { element.onclick = () => { setActiveTab('today'); closeSheets(); render(); }; });
  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { editingHabitId = null; selectedEmoji = '⚡'; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-edit-habit]').forEach((element) => { element.onclick = () => { const habit = getState().habits.find((item) => item.id === element.dataset.editHabit && item.ownerId === getState().currentUserId && item.active); if (!habit) return; editingHabitId = habit.id; selectedEmoji = habit.emoji; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-habit], [data-close-nudge], [data-close-inbox], [data-close-add-friend], [data-close-social-sheet]').forEach((element) => { element.onclick = () => { closeSheets(); render(); }; });
  app.querySelectorAll('[data-close-settings]').forEach((element) => { element.onclick = () => {
    if (settingsView !== 'menu') settingsView = 'menu';
    else settingsSheetOpen = false;
    render();
  }; });
  app.querySelectorAll('[data-close-friend-profile], [data-close-friend-profile-backdrop]').forEach((element) => { element.onclick = (event) => {
    if (element.hasAttribute('data-close-friend-profile-backdrop') && event.target !== element) return;
    friendProfileUserId = null;
    friendConnectionsRequestId += 1;
    friendConnections = null;
    friendConnectionsLoading = false;
    peopleSheetOpen = friendProfileReturnTab === 'friends';
    render();
  }; });
  app.querySelectorAll('[data-close-sheet]').forEach((element) => { element.onclick = (event) => { if (event.target === element) { closeSheets(); render(); } }; });
  bindPeopleSheetActions();
  bindSheetSwipeDismiss();
  const habitForm = app.querySelector('#habit-form');
  habitForm?.addEventListener('submit', handleHabitSubmit);
  habitForm?.addEventListener('input', markHabitDirty);
  habitForm?.addEventListener('change', markHabitDirty);
  const audienceList = habitForm?.querySelector('[data-friend-audience-list]');
  const syncAudienceControls = () => {
    const audienceMode = habitForm?.querySelector('[name="audienceMode"]:checked')?.value || 'all_friends';
    const selectedMode = audienceMode === 'selected_friends';
    if (audienceList) audienceList.hidden = !selectedMode;
    audienceList?.querySelectorAll('[name="audienceIds"]').forEach((checkbox) => {
      if (audienceMode !== 'selected_friends') checkbox.checked = false;
      checkbox.disabled = !selectedMode;
    });
  };
  habitForm?.querySelectorAll('[name="audienceMode"]').forEach((radio) => radio.addEventListener('change', syncAudienceControls));
  syncAudienceControls();
  const scheduleSelect = habitForm?.elements.scheduleFrequency;
  let previousScheduleValue = scheduleSelect?.value;
  syncHabitScheduleFields(habitForm);
  scheduleSelect?.addEventListener('change', () => {
    if (scheduleSelect.value === 'daily') {
      habitForm.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.checked = true; });
    } else if (previousScheduleValue === 'daily') {
      habitForm.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.checked = false; });
    }
    previousScheduleValue = scheduleSelect.value;
    syncHabitScheduleFields(habitForm);
  });
  habitForm?.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.addEventListener('change', () => {
    if (checkbox.checked && scheduleSelect) scheduleSelect.value = 'selected_weekdays';
    syncHabitScheduleFields(habitForm);
  }); });
  app.querySelector('[data-toggle-habit-pause]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const panel = app.querySelector('[data-habit-pause-panel]');
    if (!panel) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });
  app.querySelector('#pause-form')?.addEventListener('submit', handlePauseSubmit);
  app.querySelector('#create-circle-form')?.addEventListener('submit', handleCreateCircle);
  app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);
  app.querySelector('#join-friend-form')?.addEventListener('submit', handleJoinCircle);
  app.querySelector('[data-archive-habit]')?.addEventListener('click', handleArchiveRequest);
  app.querySelector('[data-cancel-habit]')?.addEventListener('click', closeHabitEditor);
  app.querySelector('#nudge-form')?.addEventListener('submit', handleNudgeSubmit);
  app.querySelector('#comment-form')?.addEventListener('submit', handleCommentSubmit);
  app.querySelector('#baton-form')?.addEventListener('submit', handleBatonSubmit);
  app.querySelector('#recovery-form')?.addEventListener('submit', handleRecoverySubmit);
  app.querySelector('#challenge-form')?.addEventListener('submit', handleChallengeSubmit);
  app.querySelector('#stake-form')?.addEventListener('submit', handleStakeSubmit);
  app.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);
  app.querySelector('#username-form')?.addEventListener('submit', handleUsernameSubmit);
  app.querySelector('#notification-preferences-form')?.addEventListener('submit', handleNotificationPreferences);
  app.querySelector('#social-preferences-form')?.addEventListener('submit', handleSocialPreferences);
  app.querySelectorAll('[data-camera-mode]').forEach((element) => { element.onclick = () => {
    if (!dualProof || dualProof.phase !== 'main') return;
    const mode = element.dataset.cameraMode === 'dual' ? 'dual' : 'single';
    if (dualProof.mode === mode) return;
    dualProof = { ...dualProof, mode };
    render();
  }; });
  app.querySelector('[data-dual-capture]')?.addEventListener('click', () => { void captureDualCamera(); });
  app.querySelector('[data-dual-fallback-main]')?.addEventListener('click', () => openNativeCameraFallback(dualProofMainInput));
  app.querySelector('[data-dual-fallback-selfie]')?.addEventListener('click', () => openNativeCameraFallback(proofSelfieInput));
  app.querySelector('[data-dual-cancel]')?.addEventListener('click', () => { const habitId = dualProof?.habitId; clearDualProof(); proofHabit = habitId || null; render(); });
  app.querySelector('[data-camera-retake]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-main]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_main' }); render(); });
  app.querySelector('[data-dual-retake-selfie]')?.addEventListener('click', () => { clearProofReview(); dualProof = transitionDualProof(dualProof, { type: 'retake_selfie' }); render(); });
  app.querySelector('[data-retry-mutation]')?.addEventListener('click', () => retryMutation?.());
  app.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
  bindInviteActions();
  bindProofActions();
  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);
  app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
}

function syncHabitScheduleFields(habitForm = app.querySelector('#habit-form')) {
  if (!habitForm) return;
  const frequency = habitForm.elements.scheduleFrequency?.value || 'daily';
  const weeklyTarget = habitForm.querySelector('[data-weekly-target]');
  const weekdays = habitForm.querySelector('[data-schedule-weekdays]');
  if (weeklyTarget) weeklyTarget.hidden = frequency !== 'times_per_week';
  if (weekdays) weekdays.hidden = !['selected_weekdays', 'weekly'].includes(frequency);
  const weeklyTargetSelect = habitForm.elements.weeklyTargetDays;
  if (weeklyTargetSelect) weeklyTargetSelect.disabled = frequency !== 'times_per_week';
}

function restoreScreenScroll() {
  const scroller = app.querySelector('#content-scroll');
  if (scroller) scroller.scrollTop = screenScroll[tab] || 0;
}

function renderPreservingScroll() {
  const contentScroll = app.querySelector('#content-scroll')?.scrollTop ?? screenScroll[tab] ?? 0;
  screenScroll[tab] = contentScroll;
  const sheetScroll = app.querySelector('[data-sheet]')?.scrollTop ?? 0;
  render();
  const nextContent = app.querySelector('#content-scroll');
  const nextSheet = app.querySelector('[data-sheet]');
  if (nextContent) nextContent.scrollTop = contentScroll;
  if (nextSheet) nextSheet.scrollTop = sheetScroll;
}

function bindSheetSwipeDismiss() {
  app.querySelectorAll('[data-sheet]').forEach((sheet) => {
    if (sheet.classList.contains('wrapped-sheet') || sheet.dataset.swipeDismissBound === 'true') return;
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

    sheet.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
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

    const finish = () => {
      if (!tracking) return;
      const elapsed = Math.max(1, performance.now() - startAt);
      const velocity = dragY / elapsed;
      const shouldClose = dragY >= 96 || (dragY >= 36 && velocity >= 0.55);
      tracking = false;
      if (shouldClose) {
        resetVisuals();
        if (sheet.classList.contains('comment-sheet')) {
          closeCommentSheet();
          return;
        }
        if (sheet.classList.contains('people-sheet')) {
          closePeopleSheet();
          return;
        }
        closeSheets();
        render();
        return;
      }
      resetVisuals();
    };

    sheet.addEventListener('touchend', finish, { passive: true });
    sheet.addEventListener('touchcancel', () => {
      tracking = false;
      resetVisuals();
    }, { passive: true });
  });
}

function closeSheets() {
  habitSheetOpen = false;
  editingHabitId = null;
  settingsSheetOpen = false;
  nudgeComposerUserId = null;
  friendProfileUserId = null;
  friendConnectionsRequestId += 1;
  friendConnections = null;
  friendConnectionsLoading = false;
  recoveryHabitId = null;
  challengeSheetOpen = false;
  challengeInfoOpen = false;
  stakeSheetOpen = false;
  settingsView = 'menu';
  nudgeInboxOpen = false;
  inviteSheetOpen = false;
  addFriendSheetOpen = false;
  peopleSheetOpen = false;
  clearTimeout(peopleSearchDebounceTimer);
  peopleSearchDebounceTimer = null;
  peopleSearchRequestId += 1;
  peopleSuggestionsRequestId += 1;
  peopleSearchQuery = '';
  peopleSearchResults = [];
  peopleSearchLoading = false;
  peopleSuggestions = [];
  peopleSuggestionsLoading = false;
  discoveryProfilePerson = null;
  commentCheckInId = null;
  batonSheetOpen = false;
  badgeCabinetOpen = false;
  wrappedOpen = false;
  wrappedIndex = 0;
  proofHabit = null;
  clearProofReview();
  proofRejectCheckInId = null;
  if (window.location.search.includes('nudges=')) history.replaceState({}, '', window.location.pathname);
}

function stopRefreshCoordinator() {
  refreshCoordinator?.stop();
  refreshCoordinator = null;
  manualRefreshLoading = false;
}

function hasUnsavedDraft() {
  return habitSheetOpen
    || settingsSheetOpen
    || Boolean(nudgeComposerUserId)
    || Boolean(recoveryHabitId)
    || challengeSheetOpen
    || challengeInfoOpen
    || stakeSheetOpen
    || Boolean(commentCheckInId)
    || batonSheetOpen
    || Boolean(dualProof)
    || Boolean(proofReview);
}

function shouldDeferFriendsRefreshRender() {
  const scrollTop = app.querySelector('#content-scroll')?.scrollTop ?? screenScroll.friends ?? 0;
  return tab === 'friends' && scrollTop > 4;
}

async function refreshRepositoryData(activeRepo) {
  await activeRepo.load();
  if (!session || repo !== activeRepo) return;
  authoritativeReady = true;
  reapplyOptimisticPatches();
  lastRefreshAt = new Date().toISOString();
  if (!hasUnsavedDraft() && !shouldDeferFriendsRefreshRender()) renderPreservingScroll();
  scheduleStateCacheWrite(activeRepo);
}

function startRefreshCoordinator(activeRepo) {
  stopRefreshCoordinator();
  online = navigator.onLine !== false;
  refreshCoordinator = createRefreshCoordinator({
    refresh: () => refreshRepositoryData(activeRepo),
    isVisible: () => document.visibilityState === 'visible',
    isOnline: () => navigator.onLine !== false,
    isBusy: () => busy,
    onNetworkChange: (value) => {
      if (repo !== activeRepo || !session) return;
      online = value;
      if (!hasUnsavedDraft() && !shouldDeferFriendsRefreshRender()) renderPreservingScroll();
    },
    documentTarget: document,
    windowTarget: window,
    intervalMs: 30_000,
  });
  refreshCoordinator.start();
}

async function handleApplyPwaUpdate() {
  if (hasUnsavedDraft()) {
    notify('Finish or close your draft before updating.');
    return;
  }
  pwaApplying = true;
  renderPreservingScroll();
  const applied = window.DonezoPWA?.applyUpdate?.();
  if (!applied) {
    pwaApplying = false;
    pwaUpdateAvailable = Boolean(window.DonezoPWA?.updateAvailable);
    notify('Update could not start. Try again in a moment.');
    renderPreservingScroll();
  }
}

function syncManualRefreshButton() {
  const refreshButton = app.querySelector('[data-manual-refresh]');
  if (!refreshButton) return;
  refreshButton.classList.toggle('loading', manualRefreshLoading);
  refreshButton.disabled = manualRefreshLoading;
}

async function handleManualRefresh() {
  const coordinator = refreshCoordinator;
  if (!coordinator || manualRefreshLoading) return;
  manualRefreshLoading = true;
  syncManualRefreshButton();
  const result = await coordinator.request('manual');
  if (coordinator !== refreshCoordinator) return;
  manualRefreshLoading = false;
  syncManualRefreshButton();

  if (result.status === 'refreshed') notify('Synced just now');
  else if (result.status === 'failed') notify('Refresh flopped. Keeping your last good data.', 3600);
  else if (result.reason === 'offline') notify('Still offline. Showing your last sync.', 3200);
  else if (result.reason === 'busy') notify('Finish that action first, then refresh.', 2800);
}

async function runMutation(action, successMessage, { preserveDraft = false } = {}) {
  if (busy || networkBootLoading || !authoritativeReady) {
    if (networkBootLoading || !authoritativeReady) notify('Refreshing your latest data…', 2200);
    return undefined;
  }
  if (!online) {
    mutationStatus = 'failed';
    retryMutation = () => runMutation(action, successMessage, { preserveDraft });
    notify('You are offline. Nothing was saved yet.', 3600);
    if (!preserveDraft) renderPreservingScroll();
    return undefined;
  }
  await refreshCoordinator?.waitForIdle();
  if (busy) return undefined;
  clearTimeout(runMutation.statusTimer);
  busy = true;
  mutationStatus = 'saving';
  retryMutation = null;
  if (!preserveDraft) renderPreservingScroll();
  try {
    const result = await action();
    mutationStatus = 'saved';
    if (successMessage) notify(successMessage);
    clearTimeout(runMutation.statusTimer);
    runMutation.statusTimer = setTimeout(() => { mutationStatus = 'idle'; renderPreservingScroll(); }, 1400);
    return result;
  } catch (error) {
    mutationStatus = 'failed';
    retryMutation = null;
    notify(readableError(error), 3600);
    return undefined;
  } finally {
    busy = false;
    if (!preserveDraft) renderPreservingScroll();
  }
}

async function handleAuth(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  authMessage = '';
  render();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email')).trim();
  const password = String(form.get('password'));
  try {
    if (authMode === 'sign-up') {
      const name = String(form.get('name')).trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name }, emailRedirectTo: pendingInvite.present ? (pendingInvite.valid ? buildAuthRedirectUrl(window.location.href, pendingInvite.code) : window.location.href) : window.location.origin },
      });
      if (error) throw error;
      if (!data.session) authMessage = 'Check your email, confirm the account, then sign in.';
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    authMessage = readableError(error);
  } finally {
    busy = false;
    render();
  }
}

async function handleSquadSelect(circleId) {
  if (busy || !circleId || circleId === getState()?.circleId) return;
  const result = await runMutation(() => repo.selectCircle(circleId));
  if (!result) return;
  localStorage.setItem('donezo.activeSquadId', circleId);
  settingsSheetOpen = false;
  notify(`Switched to ${getState().circleName}`);
  render();
}

async function handleCreateCircle(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runMutation(async () => {
    await repo.createCircle(String(form.get('name')));
    localStorage.setItem('donezo.activeSquadId', getState().circleId);
    settingsSheetOpen = false;
    clearPendingInvite();
    createdCircleInvite = getState().circleInviteCode;
    if (typeof repo.createFriendInvite === 'function') {
      try {
        createdFriendInvite = await repo.createFriendInvite();
        createdCircleInvite = null;
      } catch {
        // Keep legacy circle sharing available if friend invite creation is temporarily unavailable.
      }
    }
    return true;
  }, 'Squad created');
}

async function handleJoinCircle(event) {
  event.preventDefault();
  if (session && (networkBootLoading || !authoritativeReady)) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (busy) return;
  const form = new FormData(event.currentTarget);
  const validation = validateInviteCode(String(form.get('code')));
  if (!validation.valid) {
    inviteMessage = 'That invite code does not look right. Paste a fresh one or dismiss this invite.';
    render();
    return;
  }
  busy = true;
  inviteMessage = '';
  const submit = event.currentTarget.querySelector('button[type="submit"]') || event.currentTarget.querySelector('button');
  if (submit) { submit.disabled = true; submit.textContent = 'Joining…'; }
  try {
    await redeemInvite(repo, validation.code);
    if (getState().circleId) localStorage.setItem('donezo.activeSquadId', getState().circleId);
    else localStorage.removeItem('donezo.activeSquadId');
    settingsSheetOpen = false;
    addFriendSheetOpen = false;
    pendingInvite = { present: false, valid: false, code: null, raw: null };
    history.replaceState({}, '', clearInviteParam(window.location.href));
    notify('You’re in. Time to lock in.');
  } catch (error) {
    const message = readableError(error);
    inviteMessage = /invalid|expired/i.test(message)
      ? 'That invite is invalid or expired. Ask your friend for a fresh link, or enter a different code.'
      : `Couldn’t connect with that friend. ${message}`;
    notify(inviteMessage, 3600);
  } finally {
    busy = false;
    render();
  }
}

async function handleSimpleCheckIn(habit, date, checked, successMessage = '') {
  const current = checkInFor(habit.id, me()?.id, date);
  const existingId = current?.id || null;
  const previous = current ? { ...current } : null;
  const key = `checkin:${habit.id}:${date}`;
  const result = await runOptimisticMutation({
    key,
    apply: () => repo.applySimpleCheckIn(habit.id, date, checked),
    rollback: () => repo.applySimpleCheckIn(habit.id, date, Boolean(previous), previous),
    persist: () => repo.toggleSimpleCheckIn(habit.id, date, checked, existingId),
    errorMessage: checked ? 'Could not complete habit' : 'Could not undo check-in',
    onSuccess: (serverRow) => {
      if (checked && serverRow && typeof serverRow === 'object') repo.applySimpleCheckIn(habit.id, date, true, serverRow);
    },
  });
  if (result === undefined) return undefined;
  haptic(checked ? 28 : 16);
  if (successMessage) notify(successMessage, 4200, checked ? { action: { label: 'Undo', onClick: () => handleUndoCheckIn(habit.id, date) } } : {});
  renderPreservingScroll();
  return result;
}

async function handleUndoCheckIn(habitId, date = today()) {
  const habit = getState()?.habits.find((item) => item.id === habitId);
  const checkIn = checkInFor(habitId, me()?.id, date);
  if (!habit || !checkIn) return;
  if (requiresPhotoProof(habit.proofMode) || checkIn.proofPath) {
    await runMutation(() => repo.toggleHabit(habitId, date), 'Check-in undone');
    return;
  }
  await handleSimpleCheckIn(habit, date, false, 'Check-in undone');
}

function requestCheckInUndo(habit, date = today()) {
  if (!habit?.id) return;
  checkInUndoRequest = { habitId: habit.id, date };
  renderPreservingScroll();
}

async function handleHabit(id) {
  const habit = getState().habits.find((item) => item.id === id);
  if (!habit) return;
  const checkInDate = today();
  const current = checkInFor(id, me()?.id, checkInDate);
  if (current && !current.invalid) {
    requestCheckInUndo(habit, checkInDate);
    return;
  }
  const weekly = flexibleWeekProgress(habit, checkInDate);
  if (weekly?.complete) {
    notify(`${habit.title} is complete for the week.`);
    return;
  }
  if (weekly?.paused) {
    notify(`${habit.title} is paused today.`);
    return;
  }
  if (habit.proofMode === 'photo') {
    proofHabit = id;
    render();
    return;
  }
  await handleSimpleCheckIn(habit, checkInDate, true, `Checked in · ${habit.title}`);
}

function closeHabitEditor() {
  habitSheetOpen = false;
  editingHabitId = null;
  selectedEmoji = '⚡';
  render();
}

function markHabitDirty() {
  if (!editingHabitId) return;
  const dock = app.querySelector('[data-habit-save-dock]');
  if (dock) dock.hidden = false;
}

async function handleHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const input = {
    title: String(form.get('title')),
    emoji: selectedEmoji,
    frequency: String(form.get('scheduleFrequency') || 'daily'),
    scheduleFrequency: String(form.get('scheduleFrequency') || 'daily'),
    scheduleWeekdays: ['selected_weekdays', 'weekly'].includes(String(form.get('scheduleFrequency') || 'daily')) ? form.getAll('scheduleWeekdays').map(Number).sort((a, b) => a - b) : [],
    weeklyTargetDays: Number(form.get('weeklyTargetDays') || 1),
    targetQuantity: Number(form.get('targetQuantity') || 1),
    targetUnit: String(form.get('targetUnit') || 'count'),
    targetTime: String(form.get('targetTime') || ''),
    graceMinutes: Number(form.get('graceMinutes') || 0),
    scheduleTimezone: String(form.get('scheduleTimezone') || me()?.timeZone || 'UTC'),
    proofMode: String(form.get('proofMode')),
    audienceMode: String(form.get('audienceMode') || 'all_friends'),
    audienceIds: String(form.get('audienceMode') || 'all_friends') === 'selected_friends'
      ? [...new Set(form.getAll('audienceIds').map(String).filter(Boolean))]
      : [],
    squadIds: [...new Set(form.getAll('squadIds').flatMap((value) => String(value).split(',').map((id) => id.trim()).filter(Boolean)))],
  };
  if (input.scheduleFrequency === 'selected_weekdays' && !input.scheduleWeekdays.length) {
    notify('Pick at least one day for this schedule', 3200);
    return;
  }
  if (input.scheduleFrequency === 'times_per_week' && (!Number.isInteger(input.weeklyTargetDays) || input.weeklyTargetDays < 1 || input.weeklyTargetDays > 7)) {
    notify('Choose between 1 and 7 days per week', 3200);
    return;
  }
  if (input.audienceMode === 'selected_friends' && !input.audienceIds.length) {
    notify('Pick at least one friend for this habit', 3200);
    return;
  }
  const habitId = editingHabitId;
  if (habitId && checkInFor(habitId)) {
    const existing = getState().habits.find((habit) => habit.id === habitId);
    const scheduleChanged = existing && (
      input.scheduleFrequency !== (existing.scheduleFrequency || existing.frequency || 'daily')
      || input.scheduleWeekdays.join(',') !== (existing.scheduleWeekdays || []).join(',')
      || input.weeklyTargetDays !== Number(existing.weeklyTargetDays ?? 1)
      || input.targetQuantity !== Number(existing.targetQuantity ?? 1)
      || input.targetUnit.trim() !== (existing.targetUnit || 'count')
      || input.targetTime !== (existing.targetTime || '')
      || input.graceMinutes !== Number(existing.graceMinutes || 0)
      || input.scheduleTimezone !== (existing.scheduleTimezone || existing.ownerTimeZone || me()?.timeZone || 'UTC')
    );
    if (scheduleChanged) {
      notify("Today's check-in already uses the current schedule. Change it tomorrow or undo today's check-in first.", 4200);
      return;
    }
  }
  const submitButtons = [...event.currentTarget.querySelectorAll('button[type="submit"]'), ...app.querySelectorAll('[data-habit-save-dock] button[type="submit"]')];
  submitButtons.forEach((button) => {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent;
    button.textContent = 'Saving…';
  });
  const result = habitId
    ? await runMutation(() => repo.updateHabit(habitId, input), 'Habit saved', { preserveDraft: true })
    : await runMutation(() => repo.addHabit(input), `${selectedEmoji} ${input.title.trim()} added. Now actually do it.`, { preserveDraft: true });
  if (!result) {
    submitButtons.forEach((button) => {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || 'Save changes';
      delete button.dataset.originalLabel;
    });
    markHabitDirty();
    return;
  }
  closeHabitEditor();
  if (!habitId) setActiveTab('today');
  render();
}

async function handlePauseSubmit(event) {
  event.preventDefault();
  const habitId = editingHabitId;
  if (!habitId) return;
  const form = new FormData(event.currentTarget);
  const startDate = String(form.get('startDate') || '');
  const endDate = String(form.get('endDate') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    notify('Through must be on or after From', 3200);
    return;
  }
  const editing = getState().habits.find((habit) => habit.id === habitId);
  const overlaps = (editing?.pauseWindows || []).some((pause) => startDate <= pause.endDate && endDate >= pause.startDate);
  if (overlaps) {
    notify('That pause overlaps an existing pause', 3200);
    return;
  }
  const result = await runMutation(() => repo.pauseHabit(habitId, {
    startDate,
    endDate,
    reason: String(form.get('reason') || ''),
  }), 'Pause saved. No guilt tax.');
  if (!result) return;
  render();
}

async function handleUndoArchive(habitId) {
  await runMutation(() => repo.restoreHabit(habitId), 'Habit restored');
}

async function handleArchiveRequest() {
  const habitId = editingHabitId;
  if (busy || !habitId) return;
  const result = await runMutation(() => repo.archiveHabit(habitId));
  if (!result) return;
  closeHabitEditor();
  notify('Habit archived', 5000, { action: { label: 'Undo', onClick: () => handleUndoArchive(habitId) } });
}

async function handleNudgeSubmit(event) {
  event.preventDefault();
  const toUserId = nudgeComposerUserId;
  const friend = member(toUserId);
  const form = new FormData(event.currentTarget);
  const message = String(form.get('message'));
  const result = await runMutation(() => repo.sendNudge(toUserId, message, 'private'));
  if (!result) return;
  nudgeComposerUserId = null;
  const label = `Nudged ${friend?.name || 'friend'} privately ⚡`;
  notify(result.pushSent ? label : `${label} Push missed the bus 🚌`, 3200);
  render();
}

async function handleDownvote(checkInId) {
  const checkIn = getState()?.checkIns.find((item) => item.id === checkInId);
  if (!checkIn) return;
  const previous = Boolean(checkIn.userDownvoted);
  const desired = !previous;
  const result = await runOptimisticMutation({
    key: `downvote:${checkInId}`,
    apply: () => repo.applyProofDownvote(checkInId, desired),
    rollback: () => repo.applyProofDownvote(checkInId, previous),
    persist: () => repo.setProofDownvote(checkInId, desired),
    errorMessage: 'Could not update proof vote',
  });
  if (result !== undefined) haptic(18);
}

function patchReactionDom(checkInId) {
  const activity = activityList(getState()).find((item) => item.checkInId === checkInId);
  if (!activity) return;
  const buttons = [...app.querySelectorAll('[data-reaction]')].filter((button) => button.dataset.reaction === checkInId);
  const mine = (activity.userReactions || []).slice(-1);
  const counts = activity.reactionCounts || {};
  buttons.forEach((button) => {
    const emoji = button.dataset.reactionEmoji;
    const active = mine.includes(emoji);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const count = button.querySelector('span');
    if (count) count.textContent = String(counts[emoji] || 0);
  });
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
  const summary = mine.length
    ? `You reacted ${mine[0]} · ${total} ${total === 1 ? 'reaction' : 'reactions'}`
    : total ? `${total} ${total === 1 ? 'reaction' : 'reactions'}` : '';
  const summaryNode = buttons[0]?.closest('.activity-social-actions')?.querySelector('.reaction-summary');
  if (summaryNode) summaryNode.textContent = summary;
}

const reactionCoordinator = createLatestIntentCoordinator({
  persist: async (key, desired) => repo.setPositiveReaction(key.slice('reaction:'.length), desired),
  onConfirmed: () => scheduleReconciliation(),
  onError: ({ key, confirmed, error }) => {
    const checkInId = key.slice('reaction:'.length);
    optimisticPatches.delete(key);
    try { repo.applyPositiveReaction(checkInId, confirmed); } catch { /* The proof may have disappeared. */ }
    patchReactionDom(checkInId);
    notify(readableError(error), 3600);
  },
});

async function handleReaction(checkInId, emoji) {
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  const activity = activityList(getState()).find((item) => item.checkInId === checkInId);
  if (!activity) return;
  const current = (activity.userReactions || []).slice(-1)[0] || null;
  const desired = current === emoji ? null : emoji;
  const key = `reaction:${checkInId}`;
  repo.applyPositiveReaction(checkInId, desired);
  optimisticPatches.set(key, () => repo.applyPositiveReaction(checkInId, reactionCoordinator.desired(key)));
  patchReactionDom(checkInId);
  haptic(18);
  reactionCoordinator.queue(key, desired, { confirmed: reactionCoordinator.confirmed(key) ?? current });
  void reactionCoordinator.whenIdle(key).then(() => {
    if (!reactionCoordinator.isPending(key)) {
      optimisticPatches.delete(key);
      scheduleReconciliation();
    }
  });
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  const checkInId = commentCheckInId;
  const form = new FormData(event.currentTarget);
  const body = String(form.get('body') || '').trim();
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!checkInId || !body || !online) {
    if (!online) notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  const key = `comment:add:${checkInId}`;
  if (optimisticPatches.has(key)) return;
  const temp = repo.applyOptimisticComment(checkInId, body);
  optimisticPatches.set(key, () => repo.applyOptimisticComment(checkInId, body, temp));
  commentRetryDraft = null;
  refreshCommentSheet();
  await yieldToPaint();
  try {
    const saved = await repo.addComment(checkInId, body);
    repo.replaceOptimisticComment(temp.id, saved);
    optimisticPatches.delete(key);
    refreshCommentSheet();
    scheduleReconciliation();
    notify('Reply sent');
  } catch (error) {
    optimisticPatches.delete(key);
    repo.removeOptimisticComment(temp.id);
    commentRetryDraft = { checkInId, body };
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleUndoCommentDelete(comment) {
  if (!comment) return;
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  commentRetryDraft = { checkInId: comment.checkInId, body: comment.body };
  const restored = repo.applyOptimisticComment(comment.checkInId, comment.body, comment);
  try {
    const saved = await repo.addComment(comment.checkInId, comment.body);
    repo.replaceOptimisticComment(restored.id, saved);
    commentRetryDraft = null;
    scheduleReconciliation();
    refreshCommentSheet();
    notify('Reply restored');
  } catch (error) {
    repo.removeOptimisticComment(restored.id);
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleDeleteComment(commentId) {
  const comment = (getState().comments || []).find((item) => item.id === commentId);
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!comment || !online) return;
  const key = `comment:delete:${commentId}`;
  if (optimisticPatches.has(key)) return;
  const removed = repo.removeOptimisticComment(commentId);
  optimisticPatches.set(key, () => repo.removeOptimisticComment(commentId));
  refreshCommentSheet();
  await yieldToPaint();
  try {
    await repo.deleteComment(commentId);
    optimisticPatches.delete(key);
    scheduleReconciliation();
    notify('Reply deleted', 5000, { action: { label: 'Undo', onClick: () => handleUndoCommentDelete(comment) } });
  } catch (error) {
    optimisticPatches.delete(key);
    if (removed) repo.applyOptimisticComment(removed.checkInId, removed.body, removed);
    refreshCommentSheet();
    notify(readableError(error), 3600);
  }
}

async function handleBatonSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recipientUserId = String(form.get('recipientUserId') || '');
  const sourceCheckInId = String(form.get('sourceCheckInId') || '');
  const mode = event.currentTarget.dataset.mode;
  const friend = member(recipientUserId);
  const result = await runMutation(
    () => mode === 'pass' ? repo.passBaton(recipientUserId, sourceCheckInId) : repo.startBaton(recipientUserId, sourceCheckInId),
    `Baton passed to ${friend?.name || 'your friend'} ↗`,
  );
  if (result) batonSheetOpen = false;
}

function handleActivationNext(step) {
  if (step === 1) {
    editingHabitId = null;
    selectedEmoji = '⚡';
    habitSheetOpen = true;
  } else if (step === 2) inviteSheetOpen = true;
  else if (step === 3) openCheckInAction();
  else if (step === 4) setActiveTab('friends');
  render();
}

async function handleRecoverySubmit(event) {
  event.preventDefault();
  const habitId = recoveryHabitId;
  const form = new FormData(event.currentTarget);
  const action = String(form.get('action'));
  const result = await runMutation(() => repo.recoverHabit(habitId, String(form.get('missedDate')), {
    action,
    reflection: String(form.get('reflection') || ''),
    visibility: form.get('share') ? 'squad' : 'private',
  }), 'Comeback saved. Next rep.');
  if (!result) return;
  recoveryHabitId = null;
  if (action === 'adjust_habit' || action === 'pause_habit') {
    editingHabitId = habitId;
    habitSheetOpen = true;
  } else if (action === 'recover_today') {
    const habit = getState().habits.find((item) => item.id === habitId);
    if (habit?.proofMode === 'photo') proofHabit = habitId;
    else await handleHabit(habitId);
  }
  render();
}

async function handleChallengeSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await runMutation(() => repo.createChallenge({
    kind: String(form.get('kind')),
    title: String(form.get('title')),
    target: Number(form.get('target')),
    startsOn: String(form.get('startsOn')),
    endsOn: String(form.get('endsOn')),
  }), 'Challenge started. Squad goal is live.');
  if (result) challengeSheetOpen = false;
}

async function handleStakeSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await runMutation(() => repo.createStake({
    rule: String(form.get('rule')),
    reward: String(form.get('reward') || ''),
    consequence: String(form.get('consequence') || ''),
    startsOn: String(form.get('startsOn')),
    endsOn: String(form.get('endsOn')),
  }), 'Stake proposed. Everyone must opt in.');
  if (result) stakeSheetOpen = false;
}

async function handleStakeResponse(stakeId, response) {
  await runMutation(() => repo.respondToStake(stakeId, response), response === 'accepted' ? 'You’re in.' : 'Passed. Nothing activates.');
}

async function handleStakeResolve(stakeId) {
  const state = getState();
  const stake = state.stakes.find((item) => item.id === stakeId);
  if (!stake) return;
  const standings = rankMembersByWeeklyScore(friendList(state), state.habits, state.checkIns, stake.endsOn)
    .map((item) => ({ id: item.id, percent: item.weeklyScore }));
  const resolution = resolveStake(stake.rule, standings);
  await runMutation(() => repo.resolveStake(stakeId, resolution), 'Settled. Receipts are in.');
}

async function handleShareRecap() {
  const blob = await createRecapImage();
  if (!blob) return;
  const file = new File([blob], 'donezo-weekly-recap.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: `${getState().circleName} weekly recap`, files: [file] });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Recap image saved. No proof photos or private text included.');
}

function handleRedoProof(checkInId) {
  const checkIn = getState().checkIns.find((item) => item.id === checkInId);
  if (!checkIn) return;
  proofHabit = checkIn.habitId;
  render();
}

async function markNudgeReadOptimistic(nudgeId) {
  const nudge = (getState()?.nudges || []).find((item) => item.id === nudgeId);
  if (!nudge || nudge.readAt) return true;
  const readAt = new Date().toISOString();
  const previous = nudge.readAt || null;
  return runOptimisticMutation({
    key: `nudge-read:${nudgeId}`,
    apply: () => repo.applyNudgeRead(nudgeId, readAt),
    rollback: () => repo.applyNudgeRead(nudgeId, previous),
    persist: () => repo.markNudgeRead(nudgeId),
    errorMessage: 'Could not mark nudge read',
  });
}

async function handleReadNudge(nudgeId) {
  await markNudgeReadOptimistic(nudgeId);
}

async function handleUsernameSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector('[name="username"]');
  const submit = event.currentTarget.querySelector('button[type="submit"], button:not([type])');
  const raw = String(input?.value || '').trim();
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.dataset.originalLabel = submit.textContent;
    submit.textContent = 'Saving…';
  }
  try {
    const saved = await repo.setMyUsername(raw);
    if (input) input.value = saved;
    scheduleStateCacheWrite();
    notify(`Username saved · @${saved}`);
  } catch (error) {
    notify(readableError(error), 3600);
    input?.focus({ preventScroll: true });
    input?.select?.();
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = submit.dataset.originalLabel || 'Save username';
      delete submit.dataset.originalLabel;
    }
  }
}

async function handleDisplayName(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const displayName = String(form.get('displayName'));
  await runMutation(() => repo.updateDisplayName(displayName), 'Name updated ✍️');
}

async function handleNotificationPreferences(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const enabledCategories = new Set(form.getAll('category').map(String));
  const enabledHabits = new Set(form.getAll('habitEnabled').map(String));
  const categoryNames = ['due_soon', 'streak_risk', 'friend_activity', 'nudge', 'reaction', 'comment', 'challenge_progress'];
  const input = {
    quietHoursEnabled: form.has('quietHoursEnabled'),
    quietHoursStart: String(form.get('quietHoursStart') || '22:00'),
    quietHoursEnd: String(form.get('quietHoursEnd') || '08:00'),
    timezone: String(form.get('timezone') || me().timeZone || 'UTC'),
    categories: Object.fromEntries(categoryNames.map((category) => [category, enabledCategories.has(category)])),
    habitOverrides: Object.fromEntries(myHabits().map((habit) => [habit.id, enabledHabits.has(habit.id)])),
  };
  await runMutation(async () => {
    await repo.saveNotificationPreferences(input);
    return true;
  }, 'Notification settings saved');
}

async function handleSocialPreferences(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recapEnabled = form.has('recapAwardsEnabled');
  const batonEnabled = form.has('batonEnabled');
  await runMutation(async () => {
    await repo.setRecapAwardsEnabled(recapEnabled);
    await repo.setBatonEnabled(batonEnabled);
    return true;
  }, 'Social settings saved');
}


async function handleNotifications() {
  const capability = getNotificationCapability(window);
  if (capability.permission === 'granted') {
    let synced = false;
    try { synced = await syncPushSubscription(repo); } catch { synced = false; }
    const tested = await sendTestNotification();
    notify(synced && tested ? 'Push is locked in 🔔' : tested ? 'Local test works. Remote push is still cooking.' : 'Could not send notification');
    return;
  }
  const result = await enableNotifications(repo);
  notify(result.permission === 'granted'
    ? (result.pushRegistered ? 'Push is locked in 🔔' : 'Permission granted. Remote push is still cooking.')
    : `Notifications: ${result.permission}`);
  render();
}

function activeFriendInviteCode() {
  const state = getState();
  const fromValue = (value) => typeof value === 'string' ? value : value?.code || value?.inviteCode || '';
  return fromValue(createdFriendInvite)
    || fromValue(state?.friendInviteCode)
    || '';
}

function activeInviteCode() {
  const state = getState();
  const fromValue = (value) => typeof value === 'string' ? value : value?.code || value?.inviteCode || '';
  return activeFriendInviteCode()
    || fromValue(createdCircleInvite)
    || fromValue(state?.circleInviteCode)
    || '';
}

function activeInviteUrl() {
  const state = getState();
  return (typeof createdFriendInvite === 'object' ? createdFriendInvite?.url : '')
    || state?.friendInviteLink
    || '';
}

function inviteCodeFrom(value) {
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

function clearPendingInvite() {
  pendingInvite = { present: false, valid: false, code: null, raw: null };
  inviteMessage = '';
  history.replaceState({}, '', clearInviteParam(window.location.href));
}

function dismissPendingInvite() {
  clearPendingInvite();
  render();
}

function bindInviteActions() {
  app.querySelectorAll('[data-dismiss-invite]').forEach((element) => { element.onclick = dismissPendingInvite; });
  app.querySelectorAll('[data-invite-open]').forEach((element) => { element.onclick = () => { inviteSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-invite], [data-close-invite-backdrop]').forEach((element) => { element.onclick = (event) => {
    if (element.hasAttribute('data-close-invite-backdrop') && event.target !== element) return;
    inviteSheetOpen = false;
    render();
  }; });
  app.querySelectorAll('[data-share-invite]').forEach((element) => { element.onclick = handleShareInvite; });
  app.querySelectorAll('[data-continue-app]').forEach((element) => { element.onclick = () => { createdCircleInvite = null; setActiveTab('today'); createdFriendInvite = null; render(); }; });
}

async function handleSignOut() {
  const userId = session?.user?.id;
  bootGeneration += 1;
  authoritativeReady = false;
  prefetchedFriendInvite = null;
  friendInvitePromise = null;
  friendInvitePreparing = false;
  stopRefreshCoordinator();
  clearProofReview();
  proofHabit = null;
  optimisticPatches.clear();
  clearTimeout(reconciliationTimer);
  if (userId) await clearStateCache(userId);
  await supabase.auth.signOut();
}

proofInput.addEventListener('change', () => handleProofFileSelection(proofInput));
proofGalleryInput.addEventListener('change', () => handleProofFileSelection(proofGalleryInput));
document.addEventListener('paste', (event) => {
  if ((!proofHabit && !proofReview) || proofReview?.status === 'uploading') return;
  const file = imageFileFromPasteData(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  void prepareProofFile(file);
});

async function applyInitialNavigation() {
  if (initialNavigationHandled) return;
  initialNavigationHandled = true;
  if (initialNavigation.checkInId) {
    const activity = activityList(getState()).find((item) => item.checkInId === initialNavigation.checkInId);
    if (activity?.proofPath) {
      await handleProofView(activity.proofPath);
      return;
    }
  }
  requestAnimationFrame(() => {
    const target = initialNavigation.habitId
      ? [...app.querySelectorAll('[data-habit]')].find((element) => element.dataset.habit === initialNavigation.habitId)
      : [...app.querySelectorAll('[data-check-in]')].find((element) => element.dataset.checkIn === initialNavigation.checkInId);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.classList.add('deep-link-target');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  });
}

async function boot(nextSession) {
  const generation = ++bootGeneration;
  stopRefreshCoordinator();
  clearProofReview();
  proofHabit = null;
  optimisticPatches.clear();
  clearTimeout(reconciliationTimer);
  session = nextSession;
  online = navigator.onLine !== false;
  networkBootLoading = false;
  authoritativeReady = false;
  prefetchedFriendInvite = null;
  friendInvitePromise = null;
  friendInvitePreparing = false;
  if (!session) {
    repo = null;
    lastRefreshAt = null;
    render();
    return;
  }
  app.innerHTML = '<div class="standalone-screen loading"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><p>Loading your circle…</p></div>';
  const activeRepo = createSupabaseRepository(supabase, session.user);
  repo = activeRepo;
  let cachedRendered = false;
  const cachedState = await readStateCache(session.user.id);
  if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
  if (cachedState) {
    try {
      activeRepo.hydrateState(cachedState);
      cachedRendered = true;
      render();
    } catch {
      cachedRendered = false;
    }
  }
  networkBootLoading = true;
  try {
    await activeRepo.load((!initialNavigationHandled && initialNavigation.circleId) || localStorage.getItem('donezo.activeSquadId') || undefined);
    if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
    networkBootLoading = false;
    authoritativeReady = true;
    reapplyOptimisticPatches();
    lastRefreshAt = new Date().toISOString();
    render();
    scheduleStateCacheWrite(activeRepo);
    startRefreshCoordinator(activeRepo);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void syncPushSubscription(activeRepo).catch(() => {});
    }
    await applyInitialNavigation();
    if (getNotificationCapability(window).permission === 'granted') syncPushSubscription(activeRepo).catch(() => {});
  } catch (error) {
    if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
    networkBootLoading = false;
    if (cachedRendered) {
      startRefreshCoordinator(activeRepo);
      notify('Could not refresh. Showing your last good sync. ' + readableError(error), 4200);
      renderPreservingScroll();
      return;
    }
    stopRefreshCoordinator();
    app.innerHTML = `<div class="standalone-screen loading"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><h1>Could not load.</h1><p>${esc(readableError(error))}</p><button class="btn primary" id="retry">Retry</button><button class="text-btn" id="sign-out">Sign out</button></div>`;
    app.querySelector('#retry')?.addEventListener('click', () => boot(session));
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
  }
}

for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
}

window.DonezoPWA?.onUpdateAvailable?.(() => {
  pwaUpdateAvailable = true;
  if (document.body.contains(app)) renderPreservingScroll();
});
const { data: { session: initialSession } } = await supabase.auth.getSession();
await boot(initialSession);
supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event === 'TOKEN_REFRESHED') return;
  queueMicrotask(() => boot(nextSession));
});

dualProofMainInput?.addEventListener('change', async () => {
  const file = dualProofMainInput.files?.[0];
  dualProofMainInput.value = '';
  if (file) await finishDualSelection(file, 'main');
});
proofSelfieInput?.addEventListener('change', async () => {
  const file = proofSelfieInput.files?.[0];
  proofSelfieInput.value = '';
  if (file) await finishDualSelection(file, 'selfie');
});
