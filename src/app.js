import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createSupabaseRepository } from './store.js';
import { createRefreshCoordinator } from './refresh.js';
import { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, validateInviteCode } from './invite.js';
import { createProofReviewState, formatProofFileSize, transitionProofReview, validateProofFile } from './proof.js';
import {
  BADGE_CATALOG,
  dailyProgress,
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
  syncPushSubscription,
} from './notifications.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const proofInput = document.querySelector('#proof-input');
const proofGalleryInput = document.querySelector('#proof-gallery-input');
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const initialNavigation = parseNotificationDeepLink(window.location.href);
const PRIMARY_TABS = ['today', 'squad', 'league', 'me'];
const THEME_KEY = 'donezo.theme';
const requestedTab = initialNavigation.tab || localStorage.getItem('donezo.activeTab') || 'today';

let repo = null;
let session = null;
let tab = PRIMARY_TABS.includes(requestedTab) ? requestedTab : 'today';

function setActiveTab(nextTab) {
  tab = PRIMARY_TABS.includes(nextTab) ? nextTab : 'today';
  localStorage.setItem('donezo.activeTab', tab);
}
let proofHabit = null;
let proofReview = null;
let proofViewer = null;
let proofViewerRequestId = 0;
let proofRejectCheckInId = null;
let selectedEmoji = '⚡';
let habitSheetOpen = false;
let editingHabitId = null;
let settingsSheetOpen = false;
let settingsView = 'menu';
let nudgeInboxOpen = initialNavigation.nudgesOpen;
let nudgeComposerUserId = null;
let friendProfileUserId = null;
let recoveryHabitId = null;
let challengeSheetOpen = false;
let challengeInfoOpen = false;
let stakeSheetOpen = false;
let feedLimit = 12;
let inviteSheetOpen = false;
let peopleSheetOpen = false;
let squadFeed = localStorage.getItem('donezo.squadFeed') || 'proofs';
const proofThumbnailUrls = new Map();
let commentCheckInId = null;
let batonSheetOpen = false;
let badgeCabinetOpen = false;
let wrappedOpen = false;
let wrappedIndex = 0;
let createdCircleInvite = null;
let pendingInvite = parseInviteParam(window.location.href);
let inviteMessage = pendingInvite.present && !pendingInvite.valid
  ? 'That invite link looks busted. Paste a fresh 12-character code or dismiss it.'
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
const screenScroll = { today: 0, squad: 0, league: 0, me: 0 };

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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1d2433' : '#f7f2e8');
}

applyTheme(currentThemeChoice());

const starterTemplates = [
  { title: 'Move for 20 minutes', emoji: '🏃', targetTime: '18:00' },
  { title: 'Read 10 pages', emoji: '📚', targetTime: '21:00' },
  { title: 'No phone after 10', emoji: '📵', targetTime: '22:00' },
];

const getState = () => repo?.getState();
const me = () => getState()?.members.find((member) => member.id === getState().currentUserId);
const today = () => localDateInTimeZone(new Date(), me()?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const member = (id) => getState()?.members.find((item) => item.id === id);
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
  if (document.visibilityState === 'visible') requestPortraitLock();
});

function readableError(error) {
  return error?.message || 'Something went wrong';
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

function topbar() {
  const state = getState();
  const unread = incomingNudges().filter((nudge) => !nudge.readAt).length;
  const squadSwitcher = state?.circles?.length > 1
    ? `<select class="squad-switcher" data-squad-switcher aria-label="Switch squad">${state.circles.map((circle) => `<option value="${circle.id}" ${circle.id === state.circleId ? 'selected' : ''}>${esc(circle.name)}</option>`).join('')}</select>`
    : `<button class="squad-name-button" type="button" data-settings>${esc(state?.circleName || 'Squad')}</button>`;
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button>${squadSwitcher}<div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open nudges">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
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

function nav() {
  const item = (id, iconName, label) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''}" aria-label="${label}"><span class="nav-icon">${icon(iconName)}</span><small>${label}</small></button>`;
  return `<nav class="nav" aria-label="Primary">${item('today', 'home', 'Today')}${item('squad', 'squad', 'Squad')}<button data-checkin-action class="nav-btn checkin" aria-label="Check in now"><span class="nav-icon">${icon('check')}</span><small>Check In</small></button>${item('league', 'trophy', 'League')}${item('me', 'user', 'Me')}</nav>`;
}

function openCheckInAction() {
  const state = getState();
  const next = sortedTodayHabits(dueHabitsFor(state.currentUserId, today(), state)).find((habit) => !done(habit.id));
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
      ? `<div class="invite-context" role="status"><strong>Invite ready</strong><p>Sign in first. You’ll confirm joining your friend’s squad next.</p><button class="text-btn compact" type="button" data-dismiss-invite>Not my invite</button></div>`
      : `<div class="invite-context error" role="alert"><strong>Invite link looks off</strong><p>${esc(inviteMessage || 'Ask your friend for a fresh invite link.')}</p><button class="text-btn compact" type="button" data-dismiss-invite>Dismiss invite</button></div>`
    : '';
  return `<div class="standalone-screen auth-shell"><header class="auth-brand"><span>ϟ</span><strong>Donezo</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${pendingInvite.present ? 'Your invite stays with you while you sign in.' : signingUp ? 'Create an account, then make or join a squad.' : 'Your habits and your people are waiting.'}</p>${inviteContext}${authMessage ? `<div class="form-message">${esc(authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

function createCircleForm(primary = false, compact = false) {
  return `<form id="create-circle-form" class="form ${compact ? 'embedded-squad-form' : primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Create a squad</h2><p class="form-intro">Start a separate group for family, school, work, or whoever.</p><label>Squad name<input name="name" maxlength="60" required placeholder="BU Crew"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Create squad</button></form>`;
}

function joinCircleForm(primary = false, compact = false) {
  const value = pendingInvite.present ? (pendingInvite.valid ? pendingInvite.code : pendingInvite.raw || '') : '';
  return `<form id="join-circle-form" class="form ${compact ? 'embedded-squad-form' : primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Join a squad</h2><p class="form-intro">${pendingInvite.present ? 'Confirm the invite code, then join.' : 'Paste the 12-character code a friend sent you.'}</p>${inviteMessage ? `<div class="form-message">${esc(inviteMessage)}</div>` : ''}<label>Invite code<input name="code" minlength="12" maxlength="12" autocapitalize="none" required placeholder="a1b2c3d4e5f6" value="${esc(value)}"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Join squad</button>${pendingInvite.present ? '<button class="text-btn compact" type="button" data-dismiss-invite>Not this invite</button>' : ''}</form>`;
}

function onboardingScreen() {
  const inviteFirst = pendingInvite.present;
  const detail = inviteFirst
    ? (pendingInvite.valid ? 'Your friend sent an invite. Confirm it below before anything happens.' : 'That invite needs attention. Paste a fresh code or dismiss it.')
    : 'Create a squad now, then invite your people.';
  return `<div class="standalone-screen onboarding-screen"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><button class="text-btn compact" id="sign-out">Sign out</button></header><main class="onboarding-content">${pageHeading(inviteFirst ? 'Join your friends' : 'Set up your first squad', inviteFirst ? 'INVITE FOUND' : 'ONE LAST STEP', detail)}<div class="onboard-grid ${inviteFirst ? 'invite-first' : ''}">${inviteFirst ? `${joinCircleForm(true)}<div class="or"><span>OR</span></div>${createCircleForm(false)}` : `${createCircleForm(true)}<div class="or"><span>OR</span></div>${joinCircleForm(false)}`}</div></main></div>`;
}

function creatorInviteScreen() {
  const code = createdCircleInvite || getState()?.circleInviteCode || '';
  return `<div class="standalone-screen creator-success"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div></header><main class="creator-success-body"><p class="eyebrow">SQUAD CREATED</p><h1>You’re in. Bring the group.</h1><p>Share the invite now, or jump into the app and do it later from Squad.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><button class="btn full" type="button" data-continue-app>Continue to app</button><button class="text-btn" type="button" data-copy-code>Copy raw code · ${esc(code)}</button></main></div>`;
}

function myHabits(state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
}

function habitSchedule(habit) {
  return {
    frequency: habit.scheduleFrequency || habit.frequency || 'daily',
    weekdays: habit.scheduleWeekdays || [],
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

function dueHabitsFor(memberId, date = today(), state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === memberId && habit.active && habitIsDue(habit, date));
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
  const steps = [
    { done: Boolean(state.circleId), label: 'Join a squad' },
    { done: myHabits(state).length > 0, label: 'Add a habit' },
    { done: state.members.length > 1, label: 'Invite a friend' },
    { done: state.checkIns.some((item) => item.userId === state.currentUserId && !item.invalid), label: 'Post your first check-in' },
    { done: state.reactions.some((item) => item.userId === state.currentUserId && item.emoji !== '👎'), label: 'Hype a friend' },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return '';
  const next = steps.findIndex((step) => !step.done);
  return `<section class="activation-card"><div class="activation-mark" aria-hidden="true">${completed}/${steps.length}</div><div class="activation-copy"><span>Next setup step</span><strong>${esc(steps[next].label)}</strong><small>Finish this once, then it gets out of your way.</small></div><button class="btn primary small-btn" type="button" data-activation-next="${next}">${['Set up', 'Add', 'Invite', 'Check in', 'Open'][next]}</button></section>`;
}

function habitCard(habit, actionMode = false) {
  const checkIn = checkInFor(habit.id);
  const isDone = Boolean(checkIn && !checkIn.invalid);
  const rejected = Boolean(checkIn?.invalid);
  const action = rejected ? 'Run it back' : isDone ? 'Done' : habit.proofMode === 'photo' ? 'Add proof' : 'Check in';
  const target = Number(habit.targetQuantity ?? 1) !== 1 || (habit.targetUnit && habit.targetUnit !== 'count')
    ? `${habit.targetQuantity ?? 1} ${habit.targetUnit || 'count'} · `
    : '';
  const timing = contextualHabitStatus({ ...habit, completedAt: isDone ? checkIn.completedAt : null, invalid: rejected }, { date: today() });
  const detail = rejected
    ? 'Proof needs another try'
    : `${target}${timing}${habit.proofMode === 'photo' ? ' · Proof required' : ' · Truuust mode'}`;
  return `<button class="habit ${isDone ? 'done' : ''} ${rejected ? 'rejected' : ''}" data-habit="${habit.id}" ${busy ? 'disabled' : ''}><span class="habit-icon">${esc(habit.emoji)}</span><span class="habit-copy"><strong>${esc(habit.title)}</strong><small>${esc(detail)}</small></span>${actionMode ? `<span class="habit-action ${isDone ? 'complete' : ''} ${rejected ? 'rejected' : ''}">${action}</span>` : `<span class="check">${isDone ? '✓' : rejected ? '↻' : ''}</span>`}</button>`;
}

function todayScreen() {
  const state = getState();
  const habits = sortedTodayHabits(dueHabitsFor(state.currentUserId, today(), state));
  const progress = progressFor(state.currentUserId);
  const remaining = progress.total - progress.completed;
  const firstName = me().name.split(/\s+/)[0];
  const list = habits.length ? habits.map((habit) => habitCard(habit)).join('') : '<div class="empty"><b>No habits yet.</b><p>Add your first habit from Me.</p><button class="btn primary" data-open-habit>Add habit</button></div>';
  const progressCopy = progress.total === 0 ? 'Add one thing worth showing up for.' : remaining === 0 ? 'Clean sweep. You are done for today.' : `${remaining} ${remaining === 1 ? 'thing' : 'things'} left.`;
  return `${pageHeading(`${greeting()}, ${firstName}`, displayDate(), todayStatus(progress))}${activationCard()}<section class="today-progress"><div><strong>${progress.completed}/${progress.total}</strong><span>${esc(progressCopy)}</span></div><div class="bar" role="progressbar" aria-label="Today progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div></section><div class="section-head first"><h2>Today</h2><span>${progress.percent}%</span></div><div class="habit-list">${list}</div>`;
}

function checkInScreen() {
  const state = getState();
  const habits = dueHabitsFor(state.currentUserId, today(), state);
  const incomplete = habits.filter((habit) => !done(habit.id)).sort((a, b) => (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99'));
  const completed = habits.filter((habit) => done(habit.id));
  const progress = progressFor(state.currentUserId);
  return `${pageHeading('Check in', `${progress.completed}/${progress.total} DONE TODAY`, incomplete.length ? `${incomplete.length} left. Tap it and get the receipt.` : 'You are clear. Touch grass or something.')}<section class="checkin-progress"><div><b>${progress.percent}%</b><span>complete</span></div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Remaining</h2><span>${incomplete.length}</span></div><div class="habit-list">${incomplete.length ? incomplete.map((habit) => habitCard(habit, true)).join('') : '<div class="empty compact-empty"><b>All done.</b><p>Your squad has no ammo today.</p></div>'}</div>${completed.length ? `<div class="section-head subdued"><h2>Completed</h2><span>${completed.length}</span></div><div class="habit-list completed-list">${completed.map((habit) => habitCard(habit, true)).join('')}</div>` : ''}`;
}

function activityCard(activity, { showProofActions = false } = {}) {
  const actor = member(activity.userId);
  const mine = activity.userId === me().id;
  if (activity.type === 'callout') {
    const target = member(activity.toUserId);
    return `<article class="activity callout"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${mine ? 'You' : esc(actor?.name || 'Friend')} called out ${esc(target?.name || 'a friend')}</strong><small>${esc(formatWhen(activity.when))} · visible to this squad</small></div></div><div class="callout-message"><span>⚡</span><p>${esc(activity.message)}</p></div></article>`;
  }
  if (['missed', 'recovered', 'recovery'].includes(activity.type)) {
    const recovered = activity.type === 'recovered';
    const missed = activity.type === 'missed';
    const verb = missed ? 'missed one' : recovered ? 'came back' : 'made a recovery move';
    return `<article class="activity ${activity.type}"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${mine ? 'You' : esc(actor?.name || 'Friend')} ${verb}</strong><small>${esc(formatWhen(activity.when))}</small></div></div><div class="activity-body"><span>${missed ? '○' : '↩'}</span><div><strong>${esc(activity.emoji)} ${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${!mine && !missed ? `<button class="btn small-btn" data-nudge="${activity.userId}">Send support</button>` : ''}</article>`;
  }
  const checkIn = getState().checkIns.find((item) => item.id === activity.checkInId);
  const threshold = proofRejectionThreshold(getState().members.length);
  const proofPreview = showProofActions && activity.proofPath ? `<button class="proof-thumbnail" type="button" data-proof="${esc(activity.proofPath)}" data-proof-thumbnail="${esc(activity.proofPath)}" aria-label="Open ${esc(activity.habitTitle)} proof"><span aria-hidden="true">📷</span><small>Loading proof…</small></button>` : '';
  const proofActions = showProofActions && activity.proofPath ? `<div class="proof-actions"><button class="btn proof-btn" data-proof="${esc(activity.proofPath)}">Open proof</button>${mine ? (activity.invalid ? `<button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button>` : '') : `<button class="vote-btn ${activity.userDownvoted ? 'active' : ''}" data-request-reject="${activity.checkInId}" aria-label="${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}">👎 <span>${activity.downvotes || 0}${Number.isFinite(threshold) ? `/${threshold}` : ''}</span></button>`}</div>` : '';
  const commentCount = (getState().comments || []).filter((comment) => comment.checkInId === activity.checkInId).length;
  const mineReactions = activity.userReactions || [];
  const visibleReactionCounts = { ...(activity.reactionCounts || {}) };
  mineReactions.forEach((emoji) => {
    visibleReactionCounts[emoji] = Math.max(1, Number(visibleReactionCounts[emoji] || 0));
  });
  const reactionTotal = Object.values(visibleReactionCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const reactionSummary = mineReactions.length
    ? `You reacted ${mineReactions.join(' ')} · ${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}`
    : reactionTotal ? `${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}` : 'Be the first to hype this';
  const positiveReactions = `<div class="activity-social-actions"><div><div class="reaction-row" aria-label="React to this check-in">${['👏', '🔥', '💪', '😂'].map((emoji) => { const active = mineReactions.includes(emoji); return `<button type="button" class="reaction-btn ${active ? 'active' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" aria-pressed="${active}">${emoji}<span>${visibleReactionCounts[emoji] || 0}</span></button>`; }).join('')}</div><small class="reaction-summary" aria-live="polite">${esc(reactionSummary)}</small></div><button type="button" class="comment-open" data-comment-open="${activity.checkInId}">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;
  return `<article class="activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${mine ? 'You' : esc(actor?.name || 'Friend')}${activity.invalid ? ' · cooked 💀' : ''}</strong><small>${esc(formatWhen(activity.when))} · 🔥 ${activity.streak}</small></div></div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${proofPreview}${proofActions}${positiveReactions}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
}

function batonCard() {
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const holder = baton ? member(baton.holderUserId) : null;
  const mine = baton?.holderUserId === state.currentUserId;
  const eligibleCheckIn = state.checkIns.find((item) => item.userId === state.currentUserId && !item.invalid);
  const hasFriend = state.members.some((person) => person.id !== state.currentUserId);
  if (!baton) {
    if (!hasFriend) return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Invite a friend</strong><small>Hand off the next move.</small></div><button class="baton-action" type="button" data-invite-from-baton>Invite</button></section>`;
    if (!eligibleCheckIn) return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Check in to start</strong><small>Then pick who goes next.</small></div><button class="baton-action" type="button" data-baton-checkin>Go</button></section>`;
    return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>Baton · Pick who’s next</strong><small>Keep the momentum moving.</small></div><button class="baton-action" type="button" data-baton-open>Start</button></section>`;
  }
  return `<section class="baton-card baton-compact"><span class="baton-mark" aria-hidden="true">↗</span><div class="baton-copy"><strong>${mine ? 'Baton · Your turn' : `The baton is with ${esc(holder?.name || 'a friend')}`}</strong><small>${mine ? 'Check in, then pass it on.' : 'One turn at a time.'}</small></div>${mine && eligibleCheckIn && hasFriend ? '<button class="baton-action" type="button" data-pass-baton>Pass</button>' : ''}</section>`;
}

function squadScreen() {
  const state = getState();
  const feed = squadFeed === 'proofs'
    ? state.friendActivities.filter((activity) => activity.proofPath)
    : state.friendActivities.filter((activity) => !activity.proofPath);
  const visibleActivities = feed.slice(0, feedLimit);
  const groupedActivities = squadFeed === 'activity' ? groupSquadActivity(visibleActivities, state.comments || []) : visibleActivities;
  const activities = groupedActivities.map((activity) => activity.type === 'grouped_checkin'
    ? `<article class="activity grouped checkin"><div class="activity-head"><span class="activity-signature" aria-hidden="true">✓</span><div><strong>${activity.items.length} people checked in</strong><small>${esc(activity.emoji || '✓')} ${esc(activity.habitTitle)} · ${esc(formatWhen(activity.when))}</small></div></div><p>${activity.items.map((item) => esc(member(item.userId)?.name || 'Friend')).join(', ')}</p></article>`
    : activityCard(activity, { showProofActions: squadFeed === 'proofs' })).join('');
  const loadMore = feed.length > visibleActivities.length ? `<button class="btn full load-more" type="button" data-load-more>Load older updates</button>` : '';
  const syncText = lastRefreshAt ? `Synced ${formatWhen(lastRefreshAt)}` : 'Ready to sync';
  const refreshButton = `<button class="refresh-btn ${manualRefreshLoading ? 'loading' : ''}" type="button" data-manual-refresh aria-label="Refresh squad" title="Refresh" ${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span></button>`;
  const peopleButton = `<button class="invite-icon-btn" type="button" data-people-open aria-label="View squad people" title="People">${icon('people')}</button>`;
  const empty = squadFeed === 'proofs'
    ? '<div class="empty compact-empty"><b>No proofs yet.</b><p>Post a photo check-in and give the squad something to react to.</p><button class="btn primary empty-action" type="button" data-empty-checkin>Check in</button></div>'
    : '<div class="empty compact-empty"><b>No activity yet.</b><p>Somebody has to go first.</p><button class="btn primary empty-action" type="button" data-empty-checkin>Be first</button></div>';
  return `${pageHeading('Squad', state.circleName || 'YOUR SQUAD')}<div class="squad-refresh-row"><small>${esc(syncText)}</small><div class="squad-actions">${refreshButton}${peopleButton}</div></div><div class="squad-feed-tabs" role="tablist" aria-label="Squad updates"><button type="button" role="tab" aria-selected="${squadFeed === 'proofs'}" class="${squadFeed === 'proofs' ? 'active' : ''}" data-squad-feed="proofs">Proofs</button><button type="button" role="tab" aria-selected="${squadFeed === 'activity'}" class="${squadFeed === 'activity' ? 'active' : ''}" data-squad-feed="activity">Activity</button></div><div class="activity-list">${activities || empty}${loadMore}</div>`;
}

function challengeProgress(challenge) {
  const state = getState();
  const result = weeklyChallengeProgress({
    ...challenge,
    metric: challenge.kind,
    weekStart: challenge.startsOn,
    weekEnd: challenge.endsOn,
  }, {
    members: state.members,
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
    members: state.members,
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
  const ranked = rankMembersByWeeklyScore(state.members, state.habits, state.checkIns, today());
  const mine = ranked.find((item) => item.id === me().id);
  const leader = ranked[0];
  const gap = leader && mine ? Math.max(0, leader.weeklyScore - mine.weeklyScore) : 0;
  const stake = (state.stakes || []).find((item) => ['pending', 'active'].includes(item.status));
  const myConsent = stake ? (state.stakeConsents || []).find((item) => item.stakeId === stake.id && item.userId === me().id) : null;
  const canResolve = stake?.status === 'active' && stake.createdBy === me().id && today() > stake.endsOn;
  const stakeCard = stake ? `<section class="stake-card legacy-stake"><div><span>${stake.status === 'active' ? 'Existing stake' : 'Existing opt-in'}</span><strong>${esc(stake.reward || stake.consequence)}</strong><small>We retired new stakes. This one stays until the squad finishes or passes.</small></div>${stake.status === 'pending' && myConsent?.status !== 'accepted' ? `<div class="stake-actions"><button class="btn primary" data-stake-response="accepted" data-stake-id="${stake.id}">I’m in</button><button class="btn" data-stake-response="declined" data-stake-id="${stake.id}">Pass</button></div>` : canResolve ? `<button class="btn primary" data-resolve-stake="${stake.id}">Settle it</button>` : ''}</section>` : '';
  return `<div class="league-title-row">${pageHeading('League', 'THIS WEEK', 'Receipts decide the table.')}<div class="league-header-actions"><button class="league-header-action info" type="button" data-challenge-info aria-label="What are squad challenges?" title="How challenges work">${icon('eye')}</button><button class="league-header-action start" type="button" data-challenge aria-label="Start a weekly challenge" title="Start challenge">${icon('target')}</button></div></div><section class="league-summary"><span>Your rank</span><div><b>#${mine?.rank || '—'}</b><strong>${mine?.weeklyScore || 0}%</strong></div><small>${mine?.weeklyCompleted || 0}/${mine?.weeklyPossible || 0} commitments${leader?.id === mine?.id ? ' · You are on top. Act normal.' : ` · ${gap} pts behind ${esc(leader?.name || 'leader')}.`}</small></section><div class="section-head first"><h2>Standings</h2><span>${ranked.length}</span></div><div class="league-list">${ranked.map((item) => `<div class="league-row"><b>${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`}</b><div class="avatar">${esc(item.avatar)}</div><span><strong class="league-name ${item.id === me().id ? 'mine' : ''}">${esc(item.name)}${item.id === me().id ? ' · you' : ''}</strong><small>${item.weeklyCompleted}/${item.weeklyPossible} this week · 🔥 ${item.currentStreak}</small></span><strong>${item.weeklyScore}%</strong></div>`).join('')}</div>${activeChallengeCard()}${stakeCard}${challengeHistory()}${stake ? stakeHistory() : ''}`;
}

function challengeInfoSheet() {
  if (!challengeInfoOpen) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet challenge-info-sheet" role="dialog" aria-modal="true" aria-label="League actions" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">LEAGUE ACTIONS</p><h2>Move together.</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><section class="league-action-section"><div class="challenge-explainer"><span>${icon('target')}</span><p><strong>Weekly challenge</strong><br>Pick one squad target. Real check-ins move the same progress bar.</p></div><button class="btn primary full" type="button" data-challenge>Start a challenge</button></section><section class="league-action-section"><p class="eyebrow">PASS THE MOMENTUM</p>${batonCard()}</section></section></div>`;
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
  return `<button class="wrapped-entry" type="button" data-wrapped-open><span><small>${esc(monthLabel(month).toUpperCase())}</small><strong>Your month, wrapped</strong><p>${wrapped.summary.completionCount} check-ins. See the squad awards.</p></span><b aria-hidden="true">›</b></button>`;
}

function meScreen() {
  const state = getState();
  const total = state.checkIns.filter((checkIn) => checkIn.userId === me().id && !checkIn.invalid).length;
  const weekly = weeklyCompletionScore(me().id, state.habits, state.checkIns, today());
  const habits = myHabits(state);
  const ringStyle = `--progress:${Math.max(0, Math.min(100, weekly.percent)) * 3.6}deg`;
  return `${pageHeading(me().name, me().handle || session.user.email, 'Your week, your receipts.')}<section class="me-progress-hero"><div class="progress-ring" style="${ringStyle}" role="progressbar" aria-label="Weekly completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${weekly.percent}"><span><b>${weekly.percent}%</b><small>this week</small></span></div><div class="me-progress-copy"><span>PERSONAL PACE</span><h2>${weekly.percent >= 100 ? 'Clean week.' : weekly.percent >= 70 ? 'You are cooking.' : weekly.percent ? 'Keep stacking reps.' : 'Start with one.'}</h2><p>${weekly.completed}/${weekly.possible} commitments landed.</p></div></section><section class="me-stat-chips"><span><b>🔥 ${me().currentStreak}</b><small>day streak</small></span><span><b>${total}</b><small>check-ins</small></span><span><b>${state.members.length}</b><small>friends</small></span></section>${wrappedEntry()}${badgePreview()}<section class="settings-group clean-group"><div class="settings-title"><div><strong>Your habits</strong><p>${habits.length} active</p></div><button class="btn primary small-btn" data-open-habit>Add habit</button></div><div class="habit-settings-list">${habits.length ? habits.map(habitSettingsRow).join('') : '<div class="empty compact-empty"><b>No habits yet.</b><p>Add one commitment you can actually keep.</p><button class="btn primary empty-action" data-open-habit>Add first habit</button></div>'}</div></section>`;
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
  const targetQuantity = editing?.targetQuantity ?? 1;
  const targetUnit = editing?.targetUnit || 'count';
  const graceMinutes = editing?.graceMinutes || 0;
  const scheduleTimezone = editing?.scheduleTimezone || me()?.timeZone || 'UTC';
  const weekdays = [['S', 0], ['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6]];
  const pauseList = editing?.pauseWindows?.length
    ? `<div class="pause-list">${editing.pauseWindows.map((pause) => `<small>Paused ${esc(pause.startDate)} to ${esc(pause.endDate)}${pause.reason ? ` · ${esc(pause.reason)}` : ''}</small>`).join('')}</div>`
    : '';
  const pauseForm = editMode ? `<details class="schedule-pause"><summary>Pause for travel or a break</summary>${pauseList}<form id="pause-form" class="form"><div class="form-grid"><label>From<input name="startDate" type="date" required></label><label>Through<input name="endDate" type="date" required></label></div><label>Note (optional)<input name="reason" maxlength="280" placeholder="Vacation, sick, deload…"></label><button class="btn full" ${busy ? 'disabled' : ''}>Add pause</button></form></details>` : '';
  const selectedSquads = new Set(editing?.squadIds || [getState().circleId]);
  const squadChoices = getState().circles.map((circle) => `<label class="squad-check"><input type="checkbox" name="squadIds" value="${circle.id}" ${selectedSquads.has(circle.id) ? 'checked' : ''}><span><strong>${esc(circle.name)}</strong><small>${circle.id === getState().circleId ? 'Current squad' : 'Share updates here too'}</small></span></label>`).join('');
  const archiveArea = editMode
    ? `<button class="btn danger-soft full archive-btn" type="button" data-archive-habit ${busy ? 'disabled' : ''}>Archive habit</button>`
    : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-label="${editMode ? 'Edit habit' : 'Add habit'}" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>${editMode ? 'Edit habit' : 'Add a habit'}</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form">${editMode ? '' : `<div class="starter-templates"><span>Quick start</span>${starterTemplates.map((template, index) => `<button type="button" data-template="${index}">${template.emoji} ${esc(template.title)}</button>`).join('')}</div>`}<label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" value="${esc(title)}" required autofocus></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-pressed="${emoji === selectedEmoji}" class="emoji ${emoji === selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><fieldset class="schedule-fields"><legend>When does this count?</legend><label>Schedule<select name="scheduleFrequency"><option value="daily" ${scheduleFrequency === 'daily' ? 'selected' : ''}>Every day</option><option value="selected_weekdays" ${scheduleFrequency === 'selected_weekdays' ? 'selected' : ''}>Specific days</option><option value="weekly" ${scheduleFrequency === 'weekly' ? 'selected' : ''}>Once a week</option></select></label><div><span class="field-label">Days</span><div class="weekday-row">${weekdays.map(([label, day]) => `<label title="${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}"><input type="checkbox" name="scheduleWeekdays" value="${day}" ${scheduleWeekdays.has(day) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><small>Used for specific days. For weekly habits, the first picked day is due day.</small></div><div class="form-grid"><label>Amount<input name="targetQuantity" type="number" min="0.01" step="any" value="${esc(targetQuantity)}" required></label><label>Unit<input name="targetUnit" maxlength="40" value="${esc(targetUnit)}" placeholder="pages, minutes" required></label></div><div class="form-grid"><label>Due time<input name="targetTime" type="time" value="${esc(targetTime)}"></label><label>Grace<select name="graceMinutes"><option value="0" ${graceMinutes === 0 ? 'selected' : ''}>None</option><option value="30" ${graceMinutes === 30 ? 'selected' : ''}>30 min</option><option value="60" ${graceMinutes === 60 ? 'selected' : ''}>1 hour</option><option value="120" ${graceMinutes === 120 ? 'selected' : ''}>2 hours</option></select></label></div><small>Timezone: ${esc(scheduleTimezone)}</small></fieldset><input type="hidden" name="scheduleTimezone" value="${esc(scheduleTimezone)}"><label>Proof<select name="proofMode"><option value="photo" ${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value="none" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option></select></label><fieldset class="squad-sharing"><legend>Share with squads</legend><p>One check-in appears in every selected squad. Pick at least one.</p>${squadChoices}</fieldset><button class="btn primary full" ${busy ? 'disabled' : ''}>${editMode ? 'Save changes' : 'Add habit'}</button></form>${pauseForm}<div class="habit-sheet-actions">${archiveArea}<button class="text-btn" type="button" data-cancel-habit ${busy ? 'disabled' : ''}>Cancel</button></div></section></div>`;
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
  const squadList = state.circles.map((circle) => `<button type="button" class="settings-squad ${circle.id === state.circleId ? 'active' : ''}" data-select-squad="${circle.id}"><span><strong>${esc(circle.name)}</strong><small>${circle.role}${circle.id === state.circleId ? ' · active' : ''}</small></span><span>›</span></button>`).join('');
  const views = {
    menu: `<div class="settings-menu"><button type="button" data-settings-view="profile"><span class="settings-menu-icon">☺</span><span><strong>Profile & app</strong><small>Name, install help, account</small></span><b>›</b></button><button type="button" data-settings-view="squads"><span class="settings-menu-icon">◎</span><span><strong>Squads</strong><small>Switch, create, or join</small></span><b>›</b></button><button type="button" data-settings-view="appearance"><span class="settings-menu-icon">◐</span><span><strong>Appearance</strong><small>System, light, or dark</small></span><b>›</b></button><button type="button" data-settings-view="notifications"><span class="settings-menu-icon">◌</span><span><strong>Notifications</strong><small>Quiet hours and reminders</small></span><b>›</b></button><button type="button" data-settings-view="social"><span class="settings-menu-icon">↗</span><span><strong>Social & privacy</strong><small>Awards and Baton participation</small></span><b>›</b></button></div>`,
    appearance: `<section class="appearance-settings"><p class="sheet-copy">Pick what feels right. System follows your phone automatically.</p><div class="theme-choice" role="radiogroup" aria-label="App theme"><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'system'}" class="${currentThemeChoice() === 'system' ? 'active' : ''}" data-theme-choice="system"><span>◐</span><strong>System</strong></button><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'light'}" class="${currentThemeChoice() === 'light' ? 'active' : ''}" data-theme-choice="light"><span>☀</span><strong>Light</strong></button><button type="button" role="radio" aria-checked="${currentThemeChoice() === 'dark'}" class="${currentThemeChoice() === 'dark' ? 'active' : ''}" data-theme-choice="dark"><span>☾</span><strong>Dark</strong></button></div></section>`,
    profile: `<form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="btn full">Save name</button></form><div class="install-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Push works best from the installed app.</p></div><button class="text-btn danger" id="sign-out">Sign out</button>`,
    squads: `<section class="squad-manager"><div class="settings-title"><div><strong>Your squads</strong><p>Keep groups separate. Switching does not lose your place.</p></div><span>${state.circles.length}</span></div><div class="settings-squad-list">${squadList}</div><details><summary>Create another squad</summary>${createCircleForm(false, true)}</details><details><summary>Join with a code</summary>${joinCircleForm(false, true)}</details></section>`,
    notifications: `<section class="notification-settings"><div class="notification-hero"><span class="notification-hero-icon" aria-hidden="true">🔔</span><div><strong>Stay in the loop, not glued to it.</strong><small>${capability.supported ? `Push is ${capability.permission}. You control what earns a buzz.` : 'Push is not supported here. Donezo still works.'}</small></div><button class="btn small-btn" type="button" id="notification-btn">${capability.permission === 'granted' ? 'Test' : 'Enable'}</button></div><form id="notification-preferences-form" class="form notification-form"><section class="notification-panel"><div class="notification-panel-head"><div><strong>Quiet hours</strong><small>Donezo shuts up while you sleep.</small></div><label class="switch-control"><input type="checkbox" name="quietHoursEnabled" ${preferences.quietHoursEnabled ? 'checked' : ''}><span aria-hidden="true"></span></label></div><div class="quiet-hours-grid"><label>From<input name="quietHoursStart" type="time" value="${esc(preferences.quietHoursStart)}"></label><label>Until<input name="quietHoursEnd" type="time" value="${esc(preferences.quietHoursEnd)}"></label></div><label class="timezone-field">Timezone<input name="timezone" value="${esc(preferences.timezone)}" maxlength="100" required><small>Uses your habit timezone so reminders land correctly.</small></label></section><section class="notification-panel"><div class="notification-panel-head"><div><strong>What can buzz you</strong><small>Keep only the stuff you would actually open.</small></div></div><div class="notification-options">${categoryChoices}</div></section>${habitChoices ? `<section class="notification-panel"><div class="notification-panel-head"><div><strong>Habit reminders</strong><small>Mute individual habits without muting Donezo.</small></div></div><div class="notification-options">${habitChoices}</div></section>` : ''}<button class="btn primary full" ${busy ? 'disabled' : ''}>Save notifications</button></form></section>`,
    social: `<form id="social-preferences-form" class="form settings-social-form"><label class="preference-check"><input type="checkbox" name="recapAwardsEnabled" ${me().awardOptOut ? '' : 'checked'}><span><strong>Named recap awards</strong><small>Let the squad include your name in weekly and monthly awards.</small></span></label><label class="preference-check"><input type="checkbox" name="batonEnabled" ${state.batonOptedOut ? '' : 'checked'}><span><strong>Squad Baton</strong><small>Friends can pass you the next turn. No penalty if it expires.</small></span></label><button class="btn full" ${busy ? 'disabled' : ''}>Save social settings</button></form>`,
  };
  const title = ({ menu: 'Settings', profile: 'Profile & app', appearance: 'Appearance', squads: 'Squads', notifications: 'Notifications', social: 'Social & privacy' })[settingsView] || 'Settings';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div>${settingsView === 'menu' ? '<p class="eyebrow">SETTINGS</p>' : '<button class="settings-back" type="button" data-settings-back>‹ Settings</button>'}<h2>${title}</h2></div><button class="icon-btn" type="button" data-close-settings aria-label="Close">×</button></div>${views[settingsView] || views.menu}</section></div>`;
}

function nudgeComposerSheet() {
  if (!nudgeComposerUserId) return '';
  const friend = member(nudgeComposerUserId);
  const quick = ['Lock in bro 😭', "Don't sell 💀", "Clock's ticking lil bro", 'You got this 🤝'];
  return `<div class="sheet-backdrop nudge-composer-layer" data-close-sheet><section class="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Nudge friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">NUDGE ${esc(friend?.name || 'FRIEND').toUpperCase()}</p><h2>Apply pressure ⚡</h2></div><button class="icon-btn" type="button" data-close-nudge aria-label="Close">×</button></div><div class="quick-nudges">${quick.map((message) => `<button type="button" data-nudge-copy="${esc(message)}">${esc(message)}</button>`).join('')}</div><form id="nudge-form" class="form sheet-form"><label>Message<textarea name="message" maxlength="140" rows="3" required>Lock in bro 😭</textarea></label><fieldset class="visibility-choice"><legend>Who sees it?</legend><label><input type="radio" name="visibility" value="squad" checked><span><strong>Public callout</strong><small>The whole squad sees it in activity.</small></span></label><label><input type="radio" name="visibility" value="private"><span><strong>Private nudge</strong><small>Only ${esc(friend?.name || 'your friend')} sees it.</small></span></label></fieldset><div class="char-hint">140 chars max. Be annoying responsibly.</div><button class="btn primary full" ${busy ? 'disabled' : ''}>Send nudge</button></form></section></div>`;
}

function nudgeInboxSheet() {
  if (!nudgeInboxOpen) return '';
  const nudges = incomingNudges();
  const unread = nudges.filter((nudge) => !nudge.readAt);
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Nudges" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">NUDGE INBOX</p><h2>${unread.length ? `${unread.length} waiting for you` : 'Nobody is yelling rn'}</h2></div><button class="icon-btn" type="button" data-close-inbox aria-label="Close">×</button></div>${nudges.length ? `<div class="inbox-list">${nudges.map((nudge) => `<article class="inbox-nudge ${nudge.readAt ? 'read' : ''}"><div><strong>⚡ ${esc(member(nudge.fromUserId)?.name || 'Friend')}</strong><small>${esc(formatWhen(nudge.createdAt))}</small></div><p>${esc(nudge.message)}</p>${nudge.readAt ? '' : `<button class="btn small-btn" data-read-nudge="${nudge.id}">Got it</button>`}</article>`).join('')}</div>` : '<div class="empty compact-empty"><b>No nudges.</b><p>Your friends are being suspiciously nice.</p></div>'}</section></div>`;
}

function inviteSheet() {
  if (!inviteSheetOpen) return '';
  const code = getState()?.circleInviteCode || '';
  return `<div class="sheet-backdrop" data-close-invite-backdrop><section class="sheet compact-sheet invite-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="Invite friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">INVITE FRIENDS</p><h2>Bring in the squad</h2></div><button class="icon-btn" type="button" data-close-invite aria-label="Close">×</button></div><p class="invite-sheet-copy">Share the link. They’ll still have to confirm before joining.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><div class="raw-code-row"><div><small>Raw code</small><code>${esc(code)}</code></div><button class="btn small-btn" type="button" data-copy-code>Copy code</button></div></section></div>`;
}

function peopleSheet() {
  if (!peopleSheetOpen || friendProfileUserId || inviteSheetOpen) return '';
  const state = getState();
  const rows = state.members.map((person) => {
    const progress = progressFor(person.id);
    const isMe = person.id === state.currentUserId;
    const todayProgress = progress.total ? `${progress.completed}/${progress.total} today` : 'No habits today';
    return `<article class="people-row"><button class="people-profile" type="button" data-friend-profile="${person.id}" aria-label="Open ${esc(person.name)} profile"><div class="avatar">${esc(person.avatar)}</div><span><strong>${esc(person.name)}${isMe ? ' · You' : ''}</strong><small>${todayProgress} · 🔥 ${person.currentStreak}</small></span><span aria-hidden="true">›</span></button>${isMe ? '' : `<button class="btn small-btn people-nudge" type="button" data-nudge="${person.id}" ${busy ? 'disabled' : ''}>Nudge</button>`}</article>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet people-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="Squad people" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">${esc(state.circleName || 'SQUAD')}</p><h2>${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}</h2></div><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div><div class="people-list">${rows}</div><button class="btn primary full people-invite" type="button" data-invite-from-people>${icon('userPlus')} Invite people</button></section></div>`;
}

function proofRejectSheet() {
  if (!proofRejectCheckInId) return '';
  const activity = getState().friendActivities.find((item) => item.checkInId === proofRejectCheckInId);
  return `<div class="sheet-backdrop proof-reject-layer"><section class="sheet compact-sheet proof-reject-sheet" role="alertdialog" aria-modal="true" aria-label="Confirm proof rejection" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PROOF CHECK</p><h2>Reject this proof?</h2></div><button class="icon-btn" type="button" data-cancel-reject aria-label="Cancel">×</button></div><p class="sheet-copy">Only reject it if the photo genuinely does not prove ${esc(activity?.habitTitle || 'the habit')}. Enough rejections can remove the check-in from streaks and League.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-reject>Keep proof</button><button class="btn danger-soft" type="button" data-confirm-reject="${proofRejectCheckInId}">Reject proof</button></div></section></div>`;
}

function commentSheet() {
  if (!commentCheckInId) return '';
  const state = getState();
  const activity = state.friendActivities.find((item) => item.checkInId === commentCheckInId);
  const comments = (state.comments || []).filter((item) => item.checkInId === commentCheckInId);
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet comment-sheet" role="dialog" aria-modal="true" aria-label="Replies" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">QUICK REPLIES</p><h2>${esc(activity?.emoji || '✓')} ${esc(activity?.habitTitle || 'Check-in')}</h2></div><button class="icon-btn" type="button" data-close-social-sheet aria-label="Close">×</button></div><div class="comment-list">${comments.length ? comments.map((comment) => `<article class="comment-row"><div class="avatar">${esc(member(comment.authorId)?.avatar || '?')}</div><div><strong>${comment.authorId === state.currentUserId ? 'You' : esc(member(comment.authorId)?.name || 'Friend')}</strong><p>${esc(comment.body)}</p><small>${esc(formatWhen(comment.createdAt))}</small></div>${comment.authorId === state.currentUserId ? `<button class="comment-delete" type="button" data-delete-comment="${comment.id}" aria-label="Delete reply">×</button>` : ''}</article>`).join('') : '<div class="empty compact-empty"><b>No replies yet.</b><p>Keep it short. This is hype, not group chat.</p></div>'}</div><form id="comment-form" class="comment-form"><input name="body" maxlength="180" required autocomplete="off" placeholder="Say something useful…"><button class="btn primary" ${busy ? 'disabled' : ''}>Send</button></form></section></div>`;
}

function batonSheet() {
  if (!batonSheetOpen) return '';
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const source = state.checkIns.filter((item) => item.userId === state.currentUserId && !item.invalid).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  const recipients = state.members.filter((person) => person.id !== state.currentUserId);
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
  if (screen.kind === 'cover') return `<div class="wrapped-slide cover"><small>${esc(monthLabel(wrapped.period.month).toUpperCase())}</small><h2>Your squad showed up.</h2><p>Here is the month in five quick taps.</p></div>`;
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
  const recent = state.friendActivities.filter((item) => item.userId === person.id).slice(0, 5);
  const score = weeklyCompletionScore(person.id, state.habits, state.checkIns, today());
  return `<div class="sheet-backdrop" data-close-friend-profile-backdrop><section class="sheet compact-sheet friend-profile-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="${esc(person.name)} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div class="friend-profile-title"><div class="avatar">${esc(person.avatar)}</div><div><h2>${esc(person.name)}</h2><p>${score.percent}% this week · 🔥 ${person.currentStreak}</p></div></div><button class="icon-btn" type="button" data-close-friend-profile aria-label="Back to people">×</button></div><div class="profile-habits"><strong>Active habits</strong>${habits.length ? habits.map((habit) => `<span>${esc(habit.emoji)} ${esc(habit.title)}</span>`).join('') : '<p>No shared habits right now.</p>'}</div><div class="profile-recent"><strong>Recent</strong>${recent.length ? recent.map((item) => `<span>${esc(item.emoji || '⚡')} ${esc(item.habitTitle || item.message)}</span>`).join('') : '<p>No updates yet.</p>'}</div>${person.id === me().id ? '' : `<button class="btn primary full" data-nudge="${person.id}">Send a nudge</button>`}</section></div>`;
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

function proofSourceSheet() {
  if (!proofHabit || proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofHabit);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Camera first, library if the receipt already exists.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button></section></div>`;
}

function proofReviewSheet() {
  if (!proofReview) return '';
  const habit = getState()?.habits.find((item) => item.id === proofReview.habitId);
  if (!habit) return '';
  const uploading = proofReview.status === 'uploading';
  const submitLabel = uploading ? 'Uploading…' : proofReview.status === 'error' ? 'Retry proof' : 'Submit proof';
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button></div><div class="upload-status" aria-live="polite" data-upload-status>${uploading ? 'Uploading proof. Keep Donezo open.' : proofReview.status === 'error' ? 'Upload failed. Your photo is saved for retry.' : 'Ready to submit.'}</div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}

function proofViewerSheet() {
  if (!proofViewer) return '';
  const loading = proofViewer.status === 'loading';
  const actor = member(proofViewer.userId);
  const body = loading
    ? '<div class="proof-viewer-loading loading-skeleton" role="status"><span></span><p>Loading proof…</p></div>'
    : proofViewer.status === 'error'
      ? `<div class="proof-viewer-error" role="alert"><strong>Couldn’t load that proof.</strong><p>${esc(proofViewer.error || 'The signed link may have expired.')}</p><button class="btn primary" type="button" data-proof-viewer-retry>Try again</button></div>`
      : `<div class="proof-viewer-image-wrap"><img data-proof-viewer-image src="${esc(proofViewer.url)}" alt="Proof for ${esc(proofViewer.habitTitle)}"></div>`;
  return `<div class="sheet-backdrop"><section class="sheet proof-viewer-sheet" role="dialog" aria-modal="true" aria-label="View proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">PROOF</p><h2>${esc(proofViewer.habitTitle)}</h2></div><button class="icon-btn" type="button" data-proof-viewer-close aria-label="Close proof">×</button></div><div class="proof-viewer-context"><strong>${esc(actor?.name || 'Friend')}</strong><span>${esc(proofViewer.whenLabel || '')}</span></div>${body}</section></div>`;
}

function clearProofReview() {
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = null;
}

function dismissProofReview() {
  clearProofReview();
  proofHabit = null;
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

async function handleProofFileSelection(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const habitId = proofHabit || proofReview?.habitId;
  if (!habitId) return;
  const validation = validateProofFile(file);
  if (!validation.valid) {
    notify(validation.error, 3400);
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  if (proofReview?.previewUrl) URL.revokeObjectURL(proofReview.previewUrl);
  proofReview = createProofReviewState({ file, habitId, previewUrl });
  proofHabit = null;
  render();
}

async function handleProofSubmit() {
  const review = proofReview;
  if (!review || review.status === 'uploading' || busy) return;
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

async function loadProofViewerUrl() {
  const current = proofViewer;
  if (!current) return;
  const requestId = ++proofViewerRequestId;
  proofViewer = { ...current, status: 'loading', url: null, error: null };
  render();
  try {
    const url = await repo.getProofUrl(current.path);
    if (requestId !== proofViewerRequestId || !proofViewer || proofViewer.path !== current.path) return;
    proofViewer = { ...proofViewer, status: 'ready', url, error: null };
  } catch (error) {
    if (requestId !== proofViewerRequestId || !proofViewer || proofViewer.path !== current.path) return;
    proofViewer = { ...proofViewer, status: 'error', url: null, error: readableError(error) };
  }
  render();
}

async function loadProofThumbnail(element) {
  const path = element.dataset.proofThumbnail;
  if (!path || !element.isConnected) return;
  try {
    let url = proofThumbnailUrls.get(path);
    if (!url) {
      url = await repo.getProofUrl(path);
      proofThumbnailUrls.set(path, url);
    }
    if (!element.isConnected || element.dataset.proofThumbnail !== path) return;
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
  const thumbnails = [...app.querySelectorAll('[data-proof-thumbnail]')];
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
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
  app.querySelectorAll('[data-proof-source-close]').forEach((element) => { element.onclick = () => { proofHabit = null; render(); }; });
  app.querySelectorAll('[data-proof-retake]').forEach((element) => { element.onclick = () => replaceProofSelection(proofInput); });
  app.querySelectorAll('[data-proof-choose]').forEach((element) => { element.onclick = () => replaceProofSelection(proofGalleryInput); });
  app.querySelectorAll('[data-proof-review-close]').forEach((element) => { element.onclick = dismissProofReview; });
  app.querySelectorAll('[data-proof-submit]').forEach((element) => { element.onclick = handleProofSubmit; });
  app.querySelectorAll('[data-proof-viewer-close]').forEach((element) => { element.onclick = () => { proofViewerRequestId += 1; proofViewer = null; render(); }; });
  app.querySelectorAll('[data-proof-viewer-retry]').forEach((element) => { element.onclick = loadProofViewerUrl; });
  const proofViewerImage = app.querySelector('[data-proof-viewer-image]');
  const expectedUrl = proofViewer?.url;
  proofViewerImage?.addEventListener('error', () => {
    if (!proofViewer || proofViewer?.url !== expectedUrl) return;
    proofViewer = { ...proofViewer, status: 'error', url: null, error: 'That signed proof link expired. Tap try again.' };
    render();
  });
  bindProofThumbnails();
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
  if (createdCircleInvite && state?.circleId) {
    app.innerHTML = creatorInviteScreen();
    bindInviteActions();
    return;
  }
  if (!state?.circleId) {
    app.innerHTML = onboardingScreen();
    app.querySelector('#create-circle-form')?.addEventListener('submit', handleCreateCircle);
    app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
    bindInviteActions();
    return;
  }
  const screens = { today: todayScreen, squad: squadScreen, league: leagueScreen, me: meScreen };
  app.innerHTML = `<div class="app-shell">${topbar()}${offlineIndicator()}${mutationIndicator()}<main class="content-scroll" id="content-scroll">${screens[tab]()}</main>${pwaUpdateBanner()}${nav()}${habitSheet()}${settingsSheet()}${nudgeComposerSheet()}${nudgeInboxSheet()}${peopleSheet()}${inviteSheet()}${proofRejectSheet()}${commentSheet()}${batonSheet()}${challengeInfoSheet()}${badgeCabinet()}${monthlyWrappedSheet()}${friendProfileSheet()}${recoverySheet()}${challengeSheet()}${stakeSheet()}${proofSourceSheet()}${proofReviewSheet()}${proofViewerSheet()}</div>`;
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
  app.querySelectorAll('[data-select-squad]').forEach((element) => { element.onclick = () => handleSquadSelect(element.dataset.selectSquad); });
  app.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  app.querySelectorAll('[data-quick-proof]').forEach((element) => { element.onclick = () => { proofHabit = element.dataset.quickProof; chooseProofInput(proofInput); }; });
  app.querySelectorAll('[data-reaction]').forEach((element) => { element.onclick = () => handleReaction(element.dataset.reaction, element.dataset.reactionEmoji); });
  app.querySelectorAll('[data-comment-open]').forEach((element) => { element.onclick = () => { commentCheckInId = element.dataset.commentOpen; render(); }; });
  app.querySelectorAll('[data-delete-comment]').forEach((element) => { element.onclick = () => handleDeleteComment(element.dataset.deleteComment); });
  app.querySelectorAll('[data-baton-open], [data-pass-baton]').forEach((element) => { element.onclick = () => { challengeInfoOpen = false; batonSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-baton-checkin], [data-empty-checkin]').forEach((element) => { element.onclick = openCheckInAction; });
  app.querySelectorAll('[data-invite-from-baton]').forEach((element) => { element.onclick = () => { inviteSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-badge-cabinet]').forEach((element) => { element.onclick = () => { badgeCabinetOpen = true; render(); }; });
  app.querySelectorAll('[data-wrapped-open]').forEach((element) => { element.onclick = () => { wrappedOpen = true; wrappedIndex = 0; render(); }; });
  app.querySelectorAll('[data-wrapped-next]').forEach((element) => { element.onclick = () => { wrappedIndex += 1; render(); }; });
  app.querySelectorAll('[data-wrapped-prev]').forEach((element) => { element.onclick = () => { wrappedIndex = Math.max(0, wrappedIndex - 1); render(); }; });
  app.querySelectorAll('[data-wrapped-close]').forEach((element) => { element.onclick = () => { wrappedOpen = false; wrappedIndex = 0; render(); }; });
  app.querySelectorAll('[data-squad-feed]').forEach((element) => { element.onclick = () => { squadFeed = element.dataset.squadFeed; localStorage.setItem('donezo.squadFeed', squadFeed); feedLimit = 12; render(); }; });
  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; inviteSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-friend-profile]').forEach((element) => { element.onclick = () => { friendProfileUserId = element.dataset.friendProfile; render(); }; });
  app.querySelectorAll('[data-recover-habit]').forEach((element) => { element.onclick = () => { recoveryHabitId = element.dataset.recoverHabit; render(); }; });
  app.querySelectorAll('[data-challenge]').forEach((element) => { element.onclick = () => { challengeInfoOpen = false; challengeSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-challenge-info]').forEach((element) => { element.onclick = () => { challengeInfoOpen = true; render(); }; });
  app.querySelectorAll('[data-stake]').forEach((element) => { element.onclick = () => { stakeSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-stake-response]').forEach((element) => { element.onclick = () => handleStakeResponse(element.dataset.stakeId, element.dataset.stakeResponse); });
  app.querySelectorAll('[data-resolve-stake]').forEach((element) => { element.onclick = () => handleStakeResolve(element.dataset.resolveStake); });
  app.querySelectorAll('[data-load-more]').forEach((element) => { element.onclick = () => { feedLimit += 12; renderPreservingScroll(); }; });
  app.querySelectorAll('[data-share-recap]').forEach((element) => { element.onclick = handleShareRecap; });
  app.querySelectorAll('[data-apply-update]').forEach((element) => { element.onclick = handleApplyPwaUpdate; });
  app.querySelectorAll('[data-activation-next]').forEach((element) => { element.onclick = () => handleActivationNext(Number(element.dataset.activationNext)); });
  app.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => { nudgeComposerUserId = element.dataset.nudge; render(); }; });
  app.querySelectorAll('[data-proof]').forEach((element) => { element.onclick = () => handleProofView(element.dataset.proof); });
  app.querySelectorAll('[data-request-reject]').forEach((element) => { element.onclick = () => {
    const activity = getState().friendActivities.find((item) => item.checkInId === element.dataset.requestReject);
    if (activity?.userDownvoted) handleDownvote(element.dataset.requestReject);
    else { proofRejectCheckInId = element.dataset.requestReject; render(); }
  }; });
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
  app.querySelectorAll('[data-nudge-inbox]').forEach((element) => { element.onclick = () => { nudgeInboxOpen = true; render(); }; });
  app.querySelectorAll('[data-home]').forEach((element) => { element.onclick = () => { setActiveTab('today'); closeSheets(); render(); }; });
  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { editingHabitId = null; selectedEmoji = '⚡'; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-edit-habit]').forEach((element) => { element.onclick = () => { const habit = getState().habits.find((item) => item.id === element.dataset.editHabit && item.ownerId === getState().currentUserId && item.active); if (!habit) return; editingHabitId = habit.id; selectedEmoji = habit.emoji; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-habit], [data-close-nudge], [data-close-inbox], [data-close-people], [data-close-social-sheet]').forEach((element) => { element.onclick = () => { closeSheets(); render(); }; });
  app.querySelectorAll('[data-close-settings]').forEach((element) => { element.onclick = () => {
    if (settingsView !== 'menu') settingsView = 'menu';
    else settingsSheetOpen = false;
    render();
  }; });
  app.querySelectorAll('[data-close-friend-profile], [data-close-friend-profile-backdrop]').forEach((element) => { element.onclick = (event) => {
    if (element.hasAttribute('data-close-friend-profile-backdrop') && event.target !== element) return;
    friendProfileUserId = null;
    peopleSheetOpen = true;
    render();
  }; });
  app.querySelectorAll('[data-close-sheet]').forEach((element) => { element.onclick = (event) => { if (event.target === element) { closeSheets(); render(); } }; });
  const habitForm = app.querySelector('#habit-form');
  habitForm?.addEventListener('submit', handleHabitSubmit);
  habitForm?.querySelectorAll('[name="scheduleWeekdays"]').forEach((checkbox) => { checkbox.addEventListener('change', () => {
    if (checkbox.checked && habitForm.elements.scheduleFrequency) habitForm.elements.scheduleFrequency.value = 'selected_weekdays';
  }); });
  app.querySelector('#pause-form')?.addEventListener('submit', handlePauseSubmit);
  app.querySelector('#create-circle-form')?.addEventListener('submit', handleCreateCircle);
  app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);
  app.querySelector('[data-archive-habit]')?.addEventListener('click', handleArchiveRequest);
  app.querySelector('[data-cancel-habit]')?.addEventListener('click', closeHabitEditor);
  app.querySelector('#nudge-form')?.addEventListener('submit', handleNudgeSubmit);
  app.querySelector('#comment-form')?.addEventListener('submit', handleCommentSubmit);
  app.querySelector('#baton-form')?.addEventListener('submit', handleBatonSubmit);
  app.querySelector('#recovery-form')?.addEventListener('submit', handleRecoverySubmit);
  app.querySelector('#challenge-form')?.addEventListener('submit', handleChallengeSubmit);
  app.querySelector('#stake-form')?.addEventListener('submit', handleStakeSubmit);
  app.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);
  app.querySelector('#notification-preferences-form')?.addEventListener('submit', handleNotificationPreferences);
  app.querySelector('#social-preferences-form')?.addEventListener('submit', handleSocialPreferences);
  app.querySelector('[data-retry-mutation]')?.addEventListener('click', () => retryMutation?.());
  app.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
  bindInviteActions();
  bindProofActions();
  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);
  app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
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

function closeSheets() {
  habitSheetOpen = false;
  editingHabitId = null;
  settingsSheetOpen = false;
  nudgeComposerUserId = null;
  friendProfileUserId = null;
  recoveryHabitId = null;
  challengeSheetOpen = false;
  challengeInfoOpen = false;
  stakeSheetOpen = false;
  settingsView = 'menu';
  nudgeInboxOpen = false;
  inviteSheetOpen = false;
  peopleSheetOpen = false;
  commentCheckInId = null;
  batonSheetOpen = false;
  badgeCabinetOpen = false;
  wrappedOpen = false;
  wrappedIndex = 0;
  proofHabit = null;
  clearProofReview();
  proofViewer = null;
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
    || Boolean(proofReview);
}

async function refreshRepositoryData(activeRepo) {
  await activeRepo.load();
  if (!session || repo !== activeRepo) return;
  lastRefreshAt = new Date().toISOString();
  if (!hasUnsavedDraft()) renderPreservingScroll();
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
      renderPreservingScroll();
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

async function handleManualRefresh() {
  const coordinator = refreshCoordinator;
  if (!coordinator || manualRefreshLoading) return;
  manualRefreshLoading = true;
  renderPreservingScroll();
  const result = await coordinator.request('manual');
  if (coordinator !== refreshCoordinator) return;
  manualRefreshLoading = false;

  if (result.status === 'refreshed') notify('Squad refreshed. Fresh receipts 🧾');
  else if (result.status === 'failed') notify('Refresh flopped. Keeping your last good data.', 3600);
  else if (result.reason === 'offline') notify('Still offline. Showing your last sync.', 3200);
  else if (result.reason === 'busy') notify('Finish that action first, then refresh.', 2800);

  renderPreservingScroll();
}

async function runMutation(action, successMessage) {
  if (busy) return undefined;
  if (!online) {
    mutationStatus = 'failed';
    retryMutation = () => runMutation(action, successMessage);
    notify('You are offline. Nothing was saved yet.', 3600);
    renderPreservingScroll();
    return undefined;
  }
  await refreshCoordinator?.waitForIdle();
  if (busy) return undefined;
  clearTimeout(runMutation.statusTimer);
  busy = true;
  mutationStatus = 'saving';
  retryMutation = null;
  renderPreservingScroll();
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
    renderPreservingScroll();
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
    return true;
  }, 'Squad created');
}

async function handleJoinCircle(event) {
  event.preventDefault();
  if (busy) return;
  const form = new FormData(event.currentTarget);
  const validation = validateInviteCode(String(form.get('code')));
  if (!validation.valid) {
    inviteMessage = 'Invite codes are 12 letters/numbers. Paste a fresh one or dismiss this invite.';
    render();
    return;
  }
  busy = true;
  inviteMessage = '';
  const submit = event.currentTarget.querySelector('button[type="submit"]') || event.currentTarget.querySelector('button');
  if (submit) { submit.disabled = true; submit.textContent = 'Joining…'; }
  try {
    await repo.joinCircle(validation.code);
    localStorage.setItem('donezo.activeSquadId', getState().circleId);
    settingsSheetOpen = false;
    pendingInvite = { present: false, valid: false, code: null, raw: null };
    history.replaceState({}, '', clearInviteParam(window.location.href));
    notify('You’re in. Time to lock in.');
  } catch (error) {
    const message = readableError(error);
    inviteMessage = /invalid|expired/i.test(message)
      ? 'That invite is invalid or expired. Ask your friend for a fresh link, or enter a different code.'
      : `Couldn’t join that squad. ${message}`;
    notify(inviteMessage, 3600);
  } finally {
    busy = false;
    render();
  }
}

async function handleUndoCheckIn(habitId, date = today()) {
  if (!checkInFor(habitId, me()?.id, date)) return;
  await runMutation(() => repo.toggleHabit(habitId, date), 'Check-in undone');
}

async function handleHabit(id) {
  const habit = getState().habits.find((item) => item.id === id);
  if (!habit) return;
  const checkInDate = today();
  const current = checkInFor(id, me()?.id, checkInDate);
  if (current && !current.invalid) {
    await runMutation(() => repo.toggleHabit(id, checkInDate), `${habit.title} unchecked`);
    return;
  }
  if (habit.proofMode === 'photo') {
    proofHabit = id;
    render();
    return;
  }
  const result = await runMutation(() => repo.toggleHabit(id, checkInDate));
  if (!result) return;
  haptic(28);
  notify(`Checked in · ${habit.title}`, 4200, { action: { label: 'Undo', onClick: () => handleUndoCheckIn(id, checkInDate) } });
}

function closeHabitEditor() {
  habitSheetOpen = false;
  editingHabitId = null;
  selectedEmoji = '⚡';
  render();
}

async function handleHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const input = {
    title: String(form.get('title')),
    emoji: selectedEmoji,
    frequency: String(form.get('scheduleFrequency') || 'daily'),
    scheduleFrequency: String(form.get('scheduleFrequency') || 'daily'),
    scheduleWeekdays: form.getAll('scheduleWeekdays').map(Number).sort((a, b) => a - b),
    targetQuantity: Number(form.get('targetQuantity') || 1),
    targetUnit: String(form.get('targetUnit') || 'count'),
    targetTime: String(form.get('targetTime') || ''),
    graceMinutes: Number(form.get('graceMinutes') || 0),
    scheduleTimezone: String(form.get('scheduleTimezone') || me()?.timeZone || 'UTC'),
    proofMode: String(form.get('proofMode')),
    squadIds: form.getAll('squadIds').map(String),
  };
  if (input.scheduleFrequency === 'selected_weekdays' && !input.scheduleWeekdays.length) {
    notify('Pick at least one day for this schedule', 3200);
    return;
  }
  if (!input.squadIds.length) {
    notify('Pick at least one squad for this habit', 3200);
    return;
  }
  const habitId = editingHabitId;
  if (habitId && checkInFor(habitId)) {
    const existing = getState().habits.find((habit) => habit.id === habitId);
    const scheduleChanged = existing && (
      input.scheduleFrequency !== (existing.scheduleFrequency || existing.frequency || 'daily')
      || input.scheduleWeekdays.join(',') !== (existing.scheduleWeekdays || []).join(',')
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
  const result = habitId
    ? await runMutation(() => repo.updateHabit(habitId, input), 'Habit saved')
    : await runMutation(() => repo.addHabit(input), `${selectedEmoji} ${input.title.trim()} added. Now actually do it.`);
  if (!result) return;
  closeHabitEditor();
  if (!habitId) setActiveTab('today');
  render();
}

async function handlePauseSubmit(event) {
  event.preventDefault();
  const habitId = editingHabitId;
  if (!habitId) return;
  const form = new FormData(event.currentTarget);
  const result = await runMutation(() => repo.pauseHabit(habitId, {
    startDate: String(form.get('startDate') || ''),
    endDate: String(form.get('endDate') || ''),
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
  const visibility = String(form.get('visibility') || 'squad');
  const result = await runMutation(() => repo.sendNudge(toUserId, message, visibility));
  if (!result) return;
  nudgeComposerUserId = null;
  const label = visibility === 'squad' ? `Called out ${friend?.name || 'friend'} in the squad ⚡` : `Nudged ${friend?.name || 'friend'} privately ⚡`;
  notify(result.pushSent ? label : `${label} Push missed the bus 🚌`, 3200);
  render();
}

async function handleDownvote(checkInId) {
  await runMutation(() => repo.toggleDownvote(checkInId), 'Vote counted 👎');
}

async function handleReaction(checkInId, emoji) {
  const result = await runMutation(() => repo.toggleReaction(checkInId, emoji));
  if (result) haptic(18);
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  const checkInId = commentCheckInId;
  const form = new FormData(event.currentTarget);
  const body = String(form.get('body') || '').trim();
  if (!checkInId || !body) return;
  const result = await runMutation(() => repo.addComment(checkInId, body), 'Reply sent');
  if (result) commentCheckInId = checkInId;
}

async function handleUndoCommentDelete(comment) {
  await runMutation(() => repo.addComment(comment.checkInId, comment.body), 'Reply restored');
}

async function handleDeleteComment(commentId) {
  const comment = (getState().comments || []).find((item) => item.id === commentId);
  if (!comment) return;
  const result = await runMutation(() => repo.deleteComment(commentId));
  if (!result) return;
  commentCheckInId = commentCheckInId || null;
  notify('Reply deleted', 5000, { action: { label: 'Undo', onClick: () => handleUndoCommentDelete(comment) } });
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
  else if (step === 4) setActiveTab('squad');
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
  const standings = rankMembersByWeeklyScore(state.members, state.habits, state.checkIns, stake.endsOn)
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

async function handleReadNudge(nudgeId) {
  await runMutation(() => repo.markNudgeRead(nudgeId));
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

async function handleProofView(path) {
  const activity = getState().friendActivities.find((item) => item.proofPath === path);
  if (!activity) {
    notify('Could not find that proof', 3000);
    return;
  }
  proofViewer = {
    path,
    status: 'loading',
    url: null,
    error: null,
    userId: activity.userId,
    habitTitle: activity.habitTitle,
    whenLabel: formatWhen(activity.when),
  };
  render();
  await loadProofViewerUrl();
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

function activeInviteCode() {
  return createdCircleInvite || getState()?.circleInviteCode || '';
}

async function handleShareInvite() {
  const code = activeInviteCode();
  if (!validateInviteCode(code).valid) {
    notify('Invite code is not ready yet. Try again in a sec.', 3200);
    return;
  }
  const url = buildInviteLink(window.location.href, code);
  const payload = {
    title: 'Join my Donezo circle',
    text: 'Join my Donezo circle — we’re trying to actually lock in.',
    url,
  };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify('Invite link copied');
  } catch {
    notify(url, 6000);
  }
}

async function handleCopyRawInvite() {
  const code = activeInviteCode();
  try {
    await navigator.clipboard.writeText(code);
    notify('Raw invite code copied');
  } catch {
    notify(`Invite code: ${code}`, 5000);
  }
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
  app.querySelectorAll('[data-copy-code]').forEach((element) => { element.onclick = handleCopyRawInvite; });
  app.querySelectorAll('[data-continue-app]').forEach((element) => { element.onclick = () => { createdCircleInvite = null; setActiveTab('today'); render(); }; });
}

async function handleSignOut() {
  bootGeneration += 1;
  stopRefreshCoordinator();
  clearProofReview();
  proofHabit = null;
  proofViewer = null;
  await supabase.auth.signOut();
}

proofInput.addEventListener('change', () => handleProofFileSelection(proofInput));
proofGalleryInput.addEventListener('change', () => handleProofFileSelection(proofGalleryInput));

async function applyInitialNavigation() {
  if (initialNavigationHandled) return;
  initialNavigationHandled = true;
  if (initialNavigation.checkInId) {
    const activity = getState().friendActivities.find((item) => item.checkInId === initialNavigation.checkInId);
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
  proofViewer = null;
  session = nextSession;
  online = navigator.onLine !== false;
  if (!session) {
    repo = null;
    lastRefreshAt = null;
    render();
    return;
  }
  app.innerHTML = '<div class="standalone-screen loading"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><p>Loading your circle…</p></div>';
  try {
    const activeRepo = createSupabaseRepository(supabase, session.user);
    repo = activeRepo;
    await activeRepo.load((!initialNavigationHandled && initialNavigation.circleId) || localStorage.getItem('donezo.activeSquadId') || undefined);
    if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
    lastRefreshAt = new Date().toISOString();
    render();
    startRefreshCoordinator(activeRepo);
    await applyInitialNavigation();
    if (getNotificationCapability(window).permission === 'granted') {
      syncPushSubscription(activeRepo).catch(() => {});
    }
  } catch (error) {
    if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
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