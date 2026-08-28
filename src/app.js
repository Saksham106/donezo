import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createSupabaseRepository } from './store.js';
import { createRefreshCoordinator } from './refresh.js';
import { buildAuthRedirectUrl, buildInviteLink, clearInviteParam, parseInviteParam, validateInviteCode } from './invite.js';
import { createProofReviewState, formatProofFileSize, transitionProofReview, validateProofFile } from './proof.js';
import {
  dailyProgress,
  proofRejectionThreshold,
  rankMembersByWeeklyScore,
  weeklyCompletionScore,
} from './domain.js';
import {
  enableNotifications,
  getNotificationCapability,
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

let repo = null;
let session = null;
let tab = 'today';
let proofHabit = null;
let proofReview = null;
let proofViewer = null;
let proofViewerRequestId = 0;
let selectedEmoji = '⚡';
let habitSheetOpen = false;
let editingHabitId = null;
let archiveConfirm = false;
let settingsSheetOpen = false;
let nudgeInboxOpen = new URLSearchParams(window.location.search).get('nudges') === '1';
let nudgeComposerUserId = null;
let inviteSheetOpen = false;
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

const today = () => new Date().toLocaleDateString('en-CA');
const getState = () => repo?.getState();
const me = () => getState()?.members.find((member) => member.id === getState().currentUserId);
const member = (id) => getState()?.members.find((item) => item.id === id);
const checkInFor = (habitId, userId = me()?.id, date = today()) => getState()?.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === userId && checkIn.date === date);
const done = (habitId) => {
  const checkIn = checkInFor(habitId);
  return Boolean(checkIn && !checkIn.invalid);
};
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function notify(message, duration = 2400) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

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
    bolt: '<path d="m13 2-8 11h6l-1 9 9-12h-6z"/>',
    share: '<path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function incomingNudges() {
  return (getState()?.nudges || []).filter((nudge) => nudge.toUserId === me()?.id);
}

function topbar() {
  const unread = incomingNudges().filter((nudge) => !nudge.readAt).length;
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button><div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open nudges">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}

function offlineIndicator() {
  return online ? '' : '<div class="offline-indicator" role="status">Offline · reconnect to refresh</div>';
}

function nav() {
  const items = [
    ['today', 'home', 'Today'],
    ['squad', 'squad', 'Squad'],
    ['checkin', 'check', 'Check In'],
    ['league', 'trophy', 'League'],
    ['me', 'user', 'Me'],
  ];
  return `<nav class="nav" aria-label="Primary">${items.map(([id, iconName, label]) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''} ${id === 'checkin' ? 'checkin' : ''}" aria-label="${label}"><span class="nav-icon">${icon(iconName)}</span><small>${label}</small></button>`).join('')}</nav>`;
}

function pageHeading(title, meta, detail = '') {
  return `<section class="page-heading"><div><p class="eyebrow">${esc(meta)}</p><h1>${esc(title)}</h1>${detail ? `<p>${esc(detail)}</p>` : ''}</div></section>`;
}

function authScreen() {
  const signingUp = authMode === 'sign-up';
  const inviteContext = pendingInvite.present
    ? pendingInvite.valid
      ? `<div class="invite-context" role="status"><strong>Invite ready</strong><p>Sign in first. You’ll confirm joining your friend’s circle next.</p><button class="text-btn compact" type="button" data-dismiss-invite>Not my invite</button></div>`
      : `<div class="invite-context error" role="alert"><strong>Invite link looks off</strong><p>${esc(inviteMessage || 'Ask your friend for a fresh invite link.')}</p><button class="text-btn compact" type="button" data-dismiss-invite>Dismiss invite</button></div>`
    : '';
  return `<div class="standalone-screen auth-shell"><header class="auth-brand"><span>ϟ</span><strong>Donezo</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${pendingInvite.present ? 'Your invite stays with you while you sign in.' : signingUp ? 'Create an account, then make or join a circle.' : 'Your habits and your people are waiting.'}</p>${inviteContext}${authMessage ? `<div class="form-message">${esc(authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

function createCircleForm(primary = false) {
  return `<form id="create-circle-form" class="form ${primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Create a circle</h2><p class="form-intro">Start a fresh group, then invite your people.</p><label>Circle name<input name="name" maxlength="60" required placeholder="Donezo Crew"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Create circle</button></form>`;
}

function joinCircleForm(primary = false) {
  const value = pendingInvite.present ? (pendingInvite.valid ? pendingInvite.code : pendingInvite.raw || '') : '';
  return `<form id="join-circle-form" class="form ${primary ? 'onboard-primary' : 'onboard-secondary'}"><h2>Join friends</h2><p class="form-intro">${pendingInvite.present ? 'You came in through an invite. Confirm the code, then tap Join circle.' : 'Paste the 12-character code a friend sent you.'}</p>${inviteMessage ? `<div class="form-message">${esc(inviteMessage)}</div>` : ''}<label>Invite code<input name="code" minlength="12" maxlength="12" autocapitalize="none" required placeholder="a1b2c3d4e5f6" value="${esc(value)}"></label><button class="btn ${primary ? 'primary ' : ''}full" ${busy ? 'disabled' : ''}>Join circle</button>${pendingInvite.present ? '<button class="text-btn compact" type="button" data-dismiss-invite>Not this invite</button>' : ''}</form>`;
}

function onboardingScreen() {
  const inviteFirst = pendingInvite.present;
  const detail = inviteFirst
    ? (pendingInvite.valid ? 'Your friend sent an invite. Confirm it below before anything happens.' : 'That invite needs attention. Paste a fresh code or dismiss it.')
    : 'Create a circle now, then invite your people.';
  return `<div class="standalone-screen onboarding-screen"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><button class="text-btn compact" id="sign-out">Sign out</button></header><main class="onboarding-content">${pageHeading(inviteFirst ? 'Join your friends' : 'Set up your circle', inviteFirst ? 'INVITE FOUND' : 'ONE LAST STEP', detail)}<div class="onboard-grid ${inviteFirst ? 'invite-first' : ''}">${inviteFirst ? `${joinCircleForm(true)}<div class="or"><span>OR</span></div>${createCircleForm(false)}` : `${createCircleForm(true)}<div class="or"><span>OR</span></div>${joinCircleForm(false)}`}</div></main></div>`;
}

function creatorInviteScreen() {
  const code = createdCircleInvite || getState()?.circleInviteCode || '';
  return `<div class="standalone-screen creator-success"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div></header><main class="creator-success-body"><p class="eyebrow">CIRCLE CREATED</p><h1>You’re in. Bring the group.</h1><p>Share the invite now, or jump into the app and do it later from Squad.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><button class="btn full" type="button" data-continue-app>Continue to app</button><button class="text-btn" type="button" data-copy-code>Copy raw code · ${esc(code)}</button></main></div>`;
}

function myHabits(state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
}

function progressFor(memberId, date = today()) {
  const state = getState();
  const habits = state.habits.filter((habit) => habit.ownerId === memberId && habit.active);
  const completed = habits.filter((habit) => {
    const checkIn = state.checkIns.find((item) => item.habitId === habit.id && item.userId === memberId && item.date === date);
    return checkIn && !checkIn.invalid;
  }).length;
  return dailyProgress(completed, habits.length);
}

function sortedTodayHabits(habits) {
  return [...habits].sort((a, b) => Number(done(a.id)) - Number(done(b.id)) || (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99') || a.title.localeCompare(b.title));
}

function habitCard(habit, actionMode = false) {
  const checkIn = checkInFor(habit.id);
  const isDone = Boolean(checkIn && !checkIn.invalid);
  const rejected = Boolean(checkIn?.invalid);
  const action = rejected ? 'Run it back' : isDone ? 'Done' : habit.proofMode === 'photo' ? 'Add proof' : 'Check in';
  const detail = rejected
    ? 'Proof got cooked 💀'
    : `${formatTime(habit.targetTime)}${habit.proofMode === 'photo' ? ' · Proof required' : ' · Truuust mode'}`;
  return `<button class="habit ${isDone ? 'done' : ''} ${rejected ? 'rejected' : ''}" data-habit="${habit.id}" ${busy ? 'disabled' : ''}><span class="habit-icon">${esc(habit.emoji)}</span><span class="habit-copy"><strong>${esc(habit.title)}</strong><small>${esc(detail)}</small></span>${actionMode ? `<span class="habit-action ${isDone ? 'complete' : ''} ${rejected ? 'rejected' : ''}">${action}</span>` : `<span class="check">${isDone ? '✓' : rejected ? '↻' : ''}</span>`}</button>`;
}

function todayScreen() {
  const state = getState();
  const habits = sortedTodayHabits(myHabits(state));
  const progress = progressFor(state.currentUserId);
  const remaining = progress.total - progress.completed;
  const ranked = rankMembersByWeeklyScore(state.members, state.habits, state.checkIns, today());
  const mine = ranked.find((item) => item.id === state.currentUserId);
  const next = habits.find((habit) => !done(habit.id));
  const firstName = me().name.split(/\s+/)[0];
  const list = habits.length ? habits.map((habit) => habitCard(habit)).join('') : '<div class="empty"><b>No habits yet.</b><p>Add your first habit from Me.</p><button class="btn primary" data-open-habit>Add habit</button></div>';
  return `${pageHeading(`${greeting()}, ${firstName}`, displayDate(), todayStatus(progress))}<section class="metric-strip"><div><b>${remaining}</b><small>Left</small></div><div><b>${progress.percent}%</b><small>Today</small></div><div><b>🔥 ${me().currentStreak}</b><small>Streak</small></div><div><b>#${mine?.rank || '—'}</b><small>League</small></div></section>${next ? `<section class="next-up ${checkInFor(next.id)?.invalid ? 'rejected' : ''}"><div><span class="eyebrow">NEXT UP</span><strong>${esc(next.emoji)} ${esc(next.title)}</strong><small>${checkInFor(next.id)?.invalid ? 'Your proof got cooked. Run it back 😭' : `${esc(formatTime(next.targetTime))}${next.proofMode === 'photo' ? ' · Add proof' : ''}`}</small></div><button class="btn" data-habit="${next.id}">${checkInFor(next.id)?.invalid ? 'Redo' : next.proofMode === 'photo' ? 'Proof' : 'Done'}</button></section>` : ''}<div class="section-head"><h2>Today</h2><span>${progress.completed}/${progress.total}</span></div><div class="habit-list">${list}</div>`;
}

function checkInScreen() {
  const state = getState();
  const habits = myHabits(state);
  const incomplete = habits.filter((habit) => !done(habit.id)).sort((a, b) => (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99'));
  const completed = habits.filter((habit) => done(habit.id));
  const progress = progressFor(state.currentUserId);
  return `${pageHeading('Check in', `${progress.completed}/${progress.total} DONE TODAY`, incomplete.length ? `${incomplete.length} left. Tap it and get the receipt.` : 'You are clear. Touch grass or something.')}<section class="checkin-progress"><div><b>${progress.percent}%</b><span>complete</span></div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Remaining</h2><span>${incomplete.length}</span></div><div class="habit-list">${incomplete.length ? incomplete.map((habit) => habitCard(habit, true)).join('') : '<div class="empty compact-empty"><b>All done.</b><p>Your squad has no ammo today.</p></div>'}</div>${completed.length ? `<div class="section-head subdued"><h2>Completed</h2><span>${completed.length}</span></div><div class="habit-list completed-list">${completed.map((habit) => habitCard(habit, true)).join('')}</div>` : ''}`;
}

function activityCard(activity) {
  const actor = member(activity.userId);
  const mine = activity.userId === me().id;
  const checkIn = getState().checkIns.find((item) => item.id === activity.checkInId);
  const threshold = proofRejectionThreshold(getState().members.length);
  const proofActions = activity.proofPath ? `<div class="proof-actions"><button class="btn proof-btn" data-proof="${esc(activity.proofPath)}">View proof</button>${mine ? (activity.invalid ? `<button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button>` : '') : `<button class="vote-btn ${activity.userDownvoted ? 'active' : ''}" data-downvote="${activity.checkInId}" aria-label="Downvote proof">👎 <span>${activity.downvotes || 0}${Number.isFinite(threshold) ? `/${threshold}` : ''}</span></button>`}</div>` : '';
  return `<article class="activity ${activity.invalid ? 'invalid' : ''}"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${mine ? 'You' : esc(actor?.name || 'Friend')}${activity.invalid ? ' · cooked 💀' : ''}</strong><small>${esc(formatWhen(activity.when))} · 🔥 ${activity.streak}</small></div></div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${proofActions}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
}

function squadScreen() {
  const state = getState();
  const people = state.members;
  const peopleRows = people.map((person) => {
    const progress = progressFor(person.id);
    const isMe = person.id === state.currentUserId;
    return `<div class="friend-row"><div class="avatar">${esc(person.avatar)}</div><span><strong>${isMe ? `${esc(person.name)} · You` : esc(person.name)}</strong><small>${progress.completed}/${progress.total} today · 🔥 ${person.currentStreak}</small></span>${isMe ? '<span class="you-pill">you</span>' : `<button class="btn small-btn" data-nudge="${person.id}" ${busy ? 'disabled' : ''}>Nudge</button>`}</div>`;
  }).join('');
  const activities = state.friendActivities.map(activityCard).join('');
  const syncText = lastRefreshAt ? `Synced ${formatWhen(lastRefreshAt)}` : 'Ready to sync';
  const refreshButton = `<button class="btn small-btn refresh-btn ${manualRefreshLoading ? 'loading' : ''}" data-manual-refresh ${manualRefreshLoading ? 'disabled' : ''}><span aria-hidden="true">↻</span>${manualRefreshLoading ? 'Refreshing…' : 'Refresh'}</button>`;
  const inviteButton = `<button class="invite-icon-btn" type="button" data-invite-open aria-label="Invite friends" title="Invite friends">${icon('userPlus')}</button>`;
  return `${pageHeading('Squad', `${state.members.length} PEOPLE · ${state.circleName || 'YOUR CIRCLE'}`, 'Receipts, pressure, and a little public shame.')}<div class="squad-refresh-row"><small>${esc(syncText)}</small><div class="squad-actions">${refreshButton}${inviteButton}</div></div><div class="section-head first"><h2>People</h2><span>${people.length}</span></div><div class="friends-list">${peopleRows}</div><div class="section-head"><h2>Recent activity</h2><span>${state.friendActivities.length}</span></div><div class="activity-list">${activities || '<div class="empty compact-empty"><b>No receipts yet.</b><p>Somebody has to go first.</p></div>'}</div>`;
}

function leagueScreen() {
  const state = getState();
  const ranked = rankMembersByWeeklyScore(state.members, state.habits, state.checkIns, today());
  const mine = ranked.find((item) => item.id === me().id);
  const leader = ranked[0];
  const gap = leader && mine ? Math.max(0, leader.weeklyScore - mine.weeklyScore) : 0;
  return `${pageHeading('League', 'THIS WEEK', 'No fake XP. Just receipts.')}<section class="league-summary"><span>Your rank</span><div><b>#${mine?.rank || '—'}</b><strong>${mine?.weeklyScore || 0}%</strong></div><small>${mine?.weeklyCompleted || 0}/${mine?.weeklyPossible || 0} commitments counted${leader?.id === mine?.id ? ' · You are on top. Act normal.' : ` · ${gap} pts behind ${esc(leader?.name || 'leader')}.`}</small></section><div class="section-head first"><h2>Standings</h2><span>${ranked.length}</span></div><div class="league-list">${ranked.map((item) => `<div class="league-row ${item.id === me().id ? 'mine' : ''}"><b>${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`}</b><div class="avatar">${esc(item.avatar)}</div><span><strong>${esc(item.name)}</strong><small>${item.weeklyCompleted}/${item.weeklyPossible} this week · 🔥 ${item.currentStreak}</small></span><strong>${item.weeklyScore}%</strong></div>`).join('')}</div>`;
}

function habitSettingsRow(habit) {
  return `<button type="button" class="habit-setting habit-setting-button" data-edit-habit="${habit.id}" aria-label="Edit ${esc(habit.title)}"><span>${esc(habit.emoji)}</span><div><strong>${esc(habit.title)}</strong><small>${esc(formatTime(habit.targetTime))}${habit.proofMode === 'photo' ? ' · Photo proof' : ' · Truuust mode'}</small></div><span class="setting-chevron" aria-hidden="true">›</span></button>`;
}

function meScreen() {
  const state = getState();
  const total = state.checkIns.filter((checkIn) => checkIn.userId === me().id && !checkIn.invalid).length;
  const weekly = weeklyCompletionScore(me().id, state.habits, state.checkIns, today());
  const habits = myHabits(state);
  return `${pageHeading(me().name, me().handle || session.user.email, 'Your numbers and your commitments. Settings live upstairs ↗')}<section class="stats"><div><b>${weekly.percent}%</b><small>This week</small></div><div><b>🔥 ${me().currentStreak}</b><small>Streak</small></div><div><b>${total}</b><small>Valid check-ins</small></div><div><b>${state.members.length}</b><small>People</small></div></section><section class="settings-group clean-group"><div class="settings-title"><div><strong>Your habits</strong><p>${habits.length} active</p></div><button class="btn primary small-btn" data-open-habit>Add habit</button></div><div class="habit-settings-list">${habits.length ? habits.map(habitSettingsRow).join('') : '<p class="settings-empty">No habits yet.</p>'}</div></section>`;
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
  const archiveArea = editMode
    ? archiveConfirm
      ? `<div class="archive-confirm" role="alert"><strong>Archive this habit?</strong><p>It disappears from Today and Check In, but your old check-ins stay in history.</p><div><button class="btn danger-soft" type="button" data-confirm-archive ${busy ? 'disabled' : ''}>Yes, archive it</button><button class="btn" type="button" data-cancel-archive ${busy ? 'disabled' : ''}>Keep habit</button></div></div>`
      : `<button class="btn danger-soft full archive-btn" type="button" data-archive-habit ${busy ? 'disabled' : ''}>Archive habit</button>`
    : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-label="${editMode ? 'Edit habit' : 'Add habit'}" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>${editMode ? 'Edit habit' : 'Add a habit'}</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form"><label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" value="${esc(title)}" required autofocus></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" aria-pressed="${emoji === selectedEmoji}" class="emoji ${emoji === selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><label>Target time<input name="targetTime" type="time" value="${esc(targetTime)}"></label><label>Proof<select name="proofMode"><option value="photo" ${proofMode === 'photo' ? 'selected' : ''}>Photo / screenshot</option><option value="none" ${proofMode === 'none' ? 'selected' : ''}>Truuust me</option></select></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${editMode ? 'Save changes' : 'Add habit'}</button></form><div class="habit-sheet-actions">${archiveArea}<button class="text-btn" type="button" data-cancel-habit ${busy ? 'disabled' : ''}>Cancel</button></div></section></div>`;
}

function settingsSheet() {
  if (!settingsSheetOpen) return '';
  const capability = getNotificationCapability(window);
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Settings" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">SETTINGS</p><h2>Make it yours</h2></div><button class="icon-btn" type="button" data-close-settings aria-label="Close">×</button></div><form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="btn full">Save name</button></form><div class="sheet-setting"><div><strong>Notifications</strong><small>${capability.supported ? `Permission: ${capability.permission}` : 'Not supported here'}</small></div><button class="btn small-btn" id="notification-btn">${capability.permission === 'granted' ? 'Test + sync' : 'Enable'}</button></div><div class="install-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Then push notifications can actually bully you.</p></div><button class="text-btn danger" id="sign-out">Sign out</button></section></div>`;
}

function nudgeComposerSheet() {
  if (!nudgeComposerUserId) return '';
  const friend = member(nudgeComposerUserId);
  const quick = ['Lock in bro 😭', "Don't sell 💀", "Clock's ticking lil bro", 'You got this 🤝'];
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Nudge friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">NUDGE ${esc(friend?.name || 'FRIEND').toUpperCase()}</p><h2>Apply pressure ⚡</h2></div><button class="icon-btn" type="button" data-close-nudge aria-label="Close">×</button></div><div class="quick-nudges">${quick.map((message) => `<button type="button" data-nudge-copy="${esc(message)}">${esc(message)}</button>`).join('')}</div><form id="nudge-form" class="form sheet-form"><label>Message<textarea name="message" maxlength="140" rows="3" required>Lock in bro 😭</textarea></label><div class="char-hint">140 chars max. Be annoying responsibly.</div><button class="btn primary full" ${busy ? 'disabled' : ''}>Send nudge</button></form></section></div>`;
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
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet invite-sheet" role="dialog" aria-modal="true" aria-label="Invite friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">INVITE FRIENDS</p><h2>Bring in the squad</h2></div><button class="icon-btn" type="button" data-close-invite aria-label="Close">×</button></div><p class="invite-sheet-copy">Share the link. They’ll still have to confirm before joining.</p><button class="btn primary full" type="button" data-share-invite>Share invite</button><div class="raw-code-row"><div><small>Raw code</small><code>${esc(code)}</code></div><button class="btn small-btn" type="button" data-copy-code>Copy code</button></div></section></div>`;
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
  return `<div class="sheet-backdrop"><section class="sheet proof-review-sheet" role="dialog" aria-modal="true" aria-label="Review proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">REVIEW PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-review-close aria-label="Cancel proof" ${uploading ? 'disabled' : ''}>×</button></div><div class="proof-preview-frame"><img src="${esc(proofReview.previewUrl)}" alt="Selected proof for ${esc(habit.title)}"></div><div class="proof-file-meta"><strong>Looks usable?</strong><span>${esc(formatProofFileSize(proofReview.file.size))} · max 4 MB</span></div>${proofReview.error ? `<div class="proof-error" role="alert"><strong>That didn’t upload.</strong><p>${esc(proofReview.error)} Your photo is still here, so you can retry.</p></div>` : ''}<div class="proof-review-actions"><button class="btn" type="button" data-proof-retake ${uploading ? 'disabled' : ''}>Retake</button><button class="btn" type="button" data-proof-choose ${uploading ? 'disabled' : ''}>Choose another</button></div><button class="btn primary full proof-submit-btn" type="button" data-proof-submit ${uploading ? 'disabled aria-busy="true"' : ''}>${submitLabel}</button><button class="text-btn" type="button" data-proof-review-close ${uploading ? 'disabled' : ''}>Cancel</button></section></div>`;
}

function proofViewerSheet() {
  if (!proofViewer) return '';
  const loading = proofViewer.status === 'loading';
  const actor = member(proofViewer.userId);
  const body = loading
    ? '<div class="proof-viewer-loading" role="status"><span></span><p>Loading proof…</p></div>'
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
    await repo.completeWithProof(review.habitId, today(), review.file);
    if (proofReview?.previewUrl === review.previewUrl) clearProofReview();
    proofHabit = null;
    notify(`Proof saved · ${habit.title} 🧾`);
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
  const screens = { today: todayScreen, squad: squadScreen, checkin: checkInScreen, league: leagueScreen, me: meScreen };
  app.innerHTML = `<div class="app-shell">${topbar()}${offlineIndicator()}<main class="content-scroll" id="content-scroll">${screens[tab]()}</main>${nav()}${habitSheet()}${settingsSheet()}${nudgeComposerSheet()}${nudgeInboxSheet()}${inviteSheet()}${proofSourceSheet()}${proofReviewSheet()}${proofViewerSheet()}</div>`;
  app.querySelectorAll('[data-tab]').forEach((element) => { element.onclick = () => { tab = element.dataset.tab; closeSheets(); render(); }; });
  app.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  app.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => { nudgeComposerUserId = element.dataset.nudge; render(); }; });
  app.querySelectorAll('[data-proof]').forEach((element) => { element.onclick = () => handleProofView(element.dataset.proof); });
  app.querySelectorAll('[data-downvote]').forEach((element) => { element.onclick = () => handleDownvote(element.dataset.downvote); });
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
  app.querySelectorAll('[data-nudge-copy]').forEach((element) => { element.onclick = () => { const textarea = app.querySelector('#nudge-form textarea'); if (textarea) textarea.value = element.dataset.nudgeCopy; }; });
  app.querySelectorAll('[data-settings]').forEach((element) => { element.onclick = () => { settingsSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-nudge-inbox]').forEach((element) => { element.onclick = () => { nudgeInboxOpen = true; render(); }; });
  app.querySelectorAll('[data-home]').forEach((element) => { element.onclick = () => { tab = 'today'; closeSheets(); render(); }; });
  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { editingHabitId = null; archiveConfirm = false; selectedEmoji = '⚡'; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-edit-habit]').forEach((element) => { element.onclick = () => { const habit = getState().habits.find((item) => item.id === element.dataset.editHabit && item.ownerId === getState().currentUserId && item.active); if (!habit) return; editingHabitId = habit.id; archiveConfirm = false; selectedEmoji = habit.emoji; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-habit], [data-close-settings], [data-close-nudge], [data-close-inbox]').forEach((element) => { element.onclick = () => { closeSheets(); render(); }; });
  app.querySelectorAll('[data-close-sheet]').forEach((element) => { element.onclick = (event) => { if (event.target === element) { closeSheets(); render(); } }; });
  app.querySelector('#habit-form')?.addEventListener('submit', handleHabitSubmit);
  app.querySelector('[data-archive-habit]')?.addEventListener('click', handleArchiveRequest);
  app.querySelector('[data-confirm-archive]')?.addEventListener('click', handleArchiveConfirm);
  app.querySelector('[data-cancel-archive]')?.addEventListener('click', () => { archiveConfirm = false; render(); });
  app.querySelector('[data-cancel-habit]')?.addEventListener('click', closeHabitEditor);
  app.querySelector('#nudge-form')?.addEventListener('submit', handleNudgeSubmit);
  app.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);
  app.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
  bindInviteActions();
  bindProofActions();
  app.querySelector('[data-manual-refresh]')?.addEventListener('click', handleManualRefresh);
  app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
}

function renderPreservingScroll() {
  const contentScroll = app.querySelector('#content-scroll')?.scrollTop ?? 0;
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
  archiveConfirm = false;
  settingsSheetOpen = false;
  nudgeComposerUserId = null;
  nudgeInboxOpen = false;
  inviteSheetOpen = false;
  proofHabit = null;
  clearProofReview();
  proofViewer = null;
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
  await refreshCoordinator?.waitForIdle();
  if (busy) return undefined;
  busy = true;
  render();
  try {
    const result = await action();
    if (successMessage) notify(successMessage);
    return result;
  } catch (error) {
    notify(readableError(error), 3600);
    return undefined;
  } finally {
    busy = false;
    render();
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

async function handleCreateCircle(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runMutation(async () => {
    await repo.createCircle(String(form.get('name')));
    clearPendingInvite();
    createdCircleInvite = getState().circleInviteCode;
    return true;
  }, 'Circle created');
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
    pendingInvite = { present: false, valid: false, code: null, raw: null };
    history.replaceState({}, '', clearInviteParam(window.location.href));
    notify('You’re in. Time to lock in.');
  } catch (error) {
    const message = readableError(error);
    inviteMessage = /invalid|expired/i.test(message)
      ? 'That invite is invalid or expired. Ask your friend for a fresh link, or enter a different code.'
      : `Couldn’t join that circle. ${message}`;
    notify(inviteMessage, 3600);
  } finally {
    busy = false;
    render();
  }
}

async function handleHabit(id) {
  const habit = getState().habits.find((item) => item.id === id);
  if (!habit) return;
  const current = checkInFor(id);
  if (current && !current.invalid) {
    await runMutation(() => repo.toggleHabit(id, today()), `${habit.title} unchecked`);
    return;
  }
  if (habit.proofMode === 'photo') {
    proofHabit = id;
    render();
    return;
  }
  await runMutation(() => repo.toggleHabit(id, today()), `Checked in · ${habit.title}`);
}

function closeHabitEditor() {
  habitSheetOpen = false;
  editingHabitId = null;
  archiveConfirm = false;
  selectedEmoji = '⚡';
  render();
}

async function handleHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const input = {
    title: String(form.get('title')),
    emoji: selectedEmoji,
    targetTime: String(form.get('targetTime') || ''),
    proofMode: String(form.get('proofMode')),
  };
  const habitId = editingHabitId;
  const result = habitId
    ? await runMutation(() => repo.updateHabit(habitId, input), 'Habit saved')
    : await runMutation(() => repo.addHabit({ ...input, frequency: 'daily' }), `${selectedEmoji} ${input.title.trim()} added. Now actually do it.`);
  if (!result) return;
  closeHabitEditor();
  if (!habitId) tab = 'checkin';
  render();
}

function handleArchiveRequest() {
  if (busy || !editingHabitId) return;
  archiveConfirm = true;
  render();
}

async function handleArchiveConfirm() {
  const habitId = editingHabitId;
  if (!habitId) return;
  const result = await runMutation(() => repo.archiveHabit(habitId), 'Habit archived');
  if (!result) return;
  closeHabitEditor();
}

async function handleNudgeSubmit(event) {
  event.preventDefault();
  const toUserId = nudgeComposerUserId;
  const friend = member(toUserId);
  const form = new FormData(event.currentTarget);
  const message = String(form.get('message'));
  const result = await runMutation(() => repo.sendNudge(toUserId, message));
  if (!result) return;
  nudgeComposerUserId = null;
  notify(result.pushSent ? `Nudged ${friend?.name || 'friend'} ⚡` : `Nudge saved. Push missed the bus 🚌`, 3200);
  render();
}

async function handleDownvote(checkInId) {
  await runMutation(() => repo.toggleDownvote(checkInId), 'Vote counted 👎');
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
  app.querySelectorAll('[data-close-invite]').forEach((element) => { element.onclick = () => { inviteSheetOpen = false; render(); }; });
  app.querySelectorAll('[data-share-invite]').forEach((element) => { element.onclick = handleShareInvite; });
  app.querySelectorAll('[data-copy-code]').forEach((element) => { element.onclick = handleCopyRawInvite; });
  app.querySelectorAll('[data-continue-app]').forEach((element) => { element.onclick = () => { createdCircleInvite = null; tab = 'today'; render(); }; });
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
    await activeRepo.load();
    if (generation !== bootGeneration || nextSession?.user?.id !== session?.user?.id) return;
    lastRefreshAt = new Date().toISOString();
    render();
    startRefreshCoordinator(activeRepo);
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const { data: { session: initialSession } } = await supabase.auth.getSession();
await boot(initialSession);
supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event === 'TOKEN_REFRESHED') return;
  queueMicrotask(() => boot(nextSession));
});