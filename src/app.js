import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createSupabaseRepository } from './store.js';
import { dailyProgress, rankMembersByWeeklyScore, weeklyCompletionScore } from './domain.js';
import { enableNotifications, getNotificationCapability, sendTestNotification } from './notifications.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const proofInput = document.querySelector('#proof-input');
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let repo = null;
let session = null;
let tab = 'today';
let proofHabit = null;
let selectedEmoji = '⚡';
let habitSheetOpen = false;
let busy = false;
let authMode = 'sign-in';
let authMessage = '';

const today = () => new Date().toLocaleDateString('en-CA');
const getState = () => repo?.getState();
const me = () => getState()?.members.find((member) => member.id === getState().currentUserId);
const member = (id) => getState()?.members.find((item) => item.id === id);
const done = (habitId) => getState().checkIns.some((checkIn) => checkIn.habitId === habitId && checkIn.userId === me().id && checkIn.date === today());
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function notify(message, duration = 2200) {
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
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function topbar() {
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button><button class="avatar profile-button" data-profile aria-label="Open profile and settings">${esc(me()?.avatar || '?')}</button></header>`;
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
  return `<div class="standalone-screen auth-shell"><header class="auth-brand"><span>ϟ</span><strong>Donezo</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${signingUp ? 'Create an account, then make or join a circle.' : 'Your habits and your people are waiting.'}</p>${authMessage ? `<div class="form-message">${esc(authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Your name"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

function onboardingScreen() {
  return `<div class="standalone-screen onboarding-screen"><header class="topbar standalone-topbar"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><button class="text-btn compact" id="sign-out">Sign out</button></header><main class="onboarding-content">${pageHeading('Set up your circle', 'ONE LAST STEP', 'Create a squad or join one with an invite code.')}<div class="onboard-grid"><form id="create-circle-form" class="form"><h2>Create a circle</h2><label>Circle name<input name="name" maxlength="60" required placeholder="Donezo Crew"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>Create circle</button></form><div class="or"><span>OR</span></div><form id="join-circle-form" class="form"><h2>Join friends</h2><label>12-character invite code<input name="code" minlength="12" maxlength="12" autocapitalize="none" required placeholder="a1b2c3d4e5f6"></label><button class="btn full" ${busy ? 'disabled' : ''}>Join circle</button></form></div></main></div>`;
}

function myHabits(state = getState()) {
  return state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
}

function progressFor(memberId, date = today()) {
  const state = getState();
  const habits = state.habits.filter((habit) => habit.ownerId === memberId && habit.active);
  const completed = habits.filter((habit) => state.checkIns.some((checkIn) => checkIn.habitId === habit.id && checkIn.userId === memberId && checkIn.date === date)).length;
  return dailyProgress(completed, habits.length);
}

function sortedTodayHabits(habits) {
  return [...habits].sort((a, b) => Number(done(a.id)) - Number(done(b.id)) || (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99') || a.title.localeCompare(b.title));
}

function habitCard(habit, actionMode = false) {
  const isDone = done(habit.id);
  const action = isDone ? 'Done' : habit.proofMode === 'photo' ? 'Add proof' : 'Check in';
  return `<button class="habit ${isDone ? 'done' : ''}" data-habit="${habit.id}" ${busy ? 'disabled' : ''}><span class="habit-icon">${esc(habit.emoji)}</span><span class="habit-copy"><strong>${esc(habit.title)}</strong><small>${esc(formatTime(habit.targetTime))}${habit.proofMode === 'photo' ? ' · Proof required' : ''}</small></span>${actionMode ? `<span class="habit-action ${isDone ? 'complete' : ''}">${action}</span>` : `<span class="check">${isDone ? '✓' : ''}</span>`}</button>`;
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
  return `${pageHeading(`${greeting()}, ${firstName}`, displayDate(), remaining === 0 && progress.total ? 'Everything is done for today.' : `${remaining} ${remaining === 1 ? 'commitment' : 'commitments'} left today.`)}<section class="metric-strip"><div><b>${remaining}</b><small>Left</small></div><div><b>${progress.percent}%</b><small>Today</small></div><div><b>🔥 ${me().currentStreak}</b><small>Streak</small></div><div><b>#${mine?.rank || '—'}</b><small>League</small></div></section>${next ? `<section class="next-up"><div><span class="eyebrow">NEXT UP</span><strong>${esc(next.emoji)} ${esc(next.title)}</strong><small>${esc(formatTime(next.targetTime))}${next.proofMode === 'photo' ? ' · Add proof' : ''}</small></div><button class="btn" data-habit="${next.id}">${next.proofMode === 'photo' ? 'Proof' : 'Done'}</button></section>` : ''}<div class="section-head"><h2>Today</h2><span>${progress.completed}/${progress.total}</span></div><div class="habit-list">${list}</div>`;
}

function checkInScreen() {
  const state = getState();
  const habits = myHabits(state);
  const incomplete = habits.filter((habit) => !done(habit.id)).sort((a, b) => (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99'));
  const completed = habits.filter((habit) => done(habit.id));
  const progress = progressFor(state.currentUserId);
  return `${pageHeading('Check in', `${progress.completed}/${progress.total} DONE TODAY`, incomplete.length ? `${incomplete.length} left. Tap a commitment to record it.` : 'You are clear for today.')}<section class="checkin-progress"><div><b>${progress.percent}%</b><span>complete</span></div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Remaining</h2><span>${incomplete.length}</span></div><div class="habit-list">${incomplete.length ? incomplete.map((habit) => habitCard(habit, true)).join('') : '<div class="empty compact-empty"><b>All done.</b><p>Your squad can see you showed up.</p></div>'}</div>${completed.length ? `<div class="section-head subdued"><h2>Completed</h2><span>${completed.length}</span></div><div class="habit-list completed-list">${completed.map((habit) => habitCard(habit, true)).join('')}</div>` : ''}`;
}

function squadScreen() {
  const state = getState();
  const friends = state.members.filter((item) => item.id !== state.currentUserId);
  const friendRows = friends.map((friend) => {
    const progress = progressFor(friend.id);
    return `<div class="friend-row"><div class="avatar">${esc(friend.avatar)}</div><span><strong>${esc(friend.name)}</strong><small>${progress.completed}/${progress.total} today · 🔥 ${friend.currentStreak}</small></span><button class="btn small-btn" data-nudge="${friend.id}" ${busy ? 'disabled' : ''}>Nudge</button></div>`;
  }).join('');
  const activities = state.friendActivities.map((activity) => {
    const actor = member(activity.userId);
    return `<article class="activity"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${esc(actor?.name || 'Friend')}</strong><small>${esc(formatWhen(activity.when))} · 🔥 ${activity.streak}</small></div></div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${activity.proofPath ? `<button class="btn proof-btn" data-proof="${esc(activity.proofPath)}">View proof</button>` : ''}</article>`;
  }).join('');
  return `${pageHeading('Squad', `${state.members.length} PEOPLE · ${state.circleName || 'YOUR CIRCLE'}`, friends.length ? 'See who is showing up today.' : 'Invite friends to start the pressure.')}<div class="section-head first"><h2>People</h2><span>${friends.length}</span></div><div class="friends-list">${friendRows || '<div class="empty compact-empty"><b>It is quiet in here.</b><p>Share your invite code from Me.</p></div>'}</div><div class="section-head"><h2>Recent activity</h2><span>${state.friendActivities.length}</span></div><div class="activity-list">${activities || '<div class="empty compact-empty"><b>No check-ins yet.</b><p>Activity appears here when friends complete commitments.</p></div>'}</div>`;
}

function leagueScreen() {
  const state = getState();
  const ranked = rankMembersByWeeklyScore(state.members, state.habits, state.checkIns, today());
  const mine = ranked.find((item) => item.id === me().id);
  const leader = ranked[0];
  const gap = leader && mine ? Math.max(0, leader.weeklyScore - mine.weeklyScore) : 0;
  return `${pageHeading('League', 'THIS WEEK', 'Completion rate, not arbitrary points.')}<section class="league-summary"><span>Your rank</span><div><b>#${mine?.rank || '—'}</b><strong>${mine?.weeklyScore || 0}%</strong></div><small>${mine?.weeklyCompleted || 0}/${mine?.weeklyPossible || 0} commitments completed${leader?.id === mine?.id ? ' · You are on top.' : ` · ${gap} pts behind ${esc(leader?.name || 'leader')}.`}</small></section><div class="section-head first"><h2>Standings</h2><span>${ranked.length}</span></div><div class="league-list">${ranked.map((item) => `<div class="league-row ${item.id === me().id ? 'mine' : ''}"><b>${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`}</b><div class="avatar">${esc(item.avatar)}</div><span><strong>${esc(item.name)}</strong><small>${item.weeklyCompleted}/${item.weeklyPossible} this week · 🔥 ${item.currentStreak}</small></span><strong>${item.weeklyScore}%</strong></div>`).join('')}</div>`;
}

function habitSettingsRow(habit) {
  return `<div class="habit-setting"><span>${esc(habit.emoji)}</span><div><strong>${esc(habit.title)}</strong><small>${esc(formatTime(habit.targetTime))}${habit.proofMode === 'photo' ? ' · Proof' : ''}</small></div></div>`;
}

function meScreen() {
  const state = getState();
  const capability = getNotificationCapability(window);
  const total = state.checkIns.filter((checkIn) => checkIn.userId === me().id).length;
  const incoming = state.nudges.filter((nudge) => nudge.toUserId === me().id).slice(0, 5);
  const weekly = weeklyCompletionScore(me().id, state.habits, state.checkIns, today());
  const habits = myHabits(state);
  return `${pageHeading(me().name, me().handle || session.user.email, 'Account, habits and app settings.')}<section class="stats"><div><b>${weekly.percent}%</b><small>This week</small></div><div><b>🔥 ${me().currentStreak}</b><small>Streak</small></div><div><b>${total}</b><small>Check-ins</small></div><div><b>${state.members.length}</b><small>People</small></div></section><section class="settings-group"><div class="settings-title"><div><strong>Habits</strong><p>${habits.length} active</p></div><button class="btn primary small-btn" data-open-habit>Add habit</button></div><div class="habit-settings-list">${habits.length ? habits.map(habitSettingsRow).join('') : '<p class="settings-empty">No habits yet.</p>'}</div></section><section class="settings invite"><div><strong>Invite friends</strong><p>Circle code: <code>${esc(state.circleInviteCode)}</code></p></div><button class="btn small-btn" id="copy-invite">Copy</button></section><section class="settings"><div><strong>Notifications</strong><p>${capability.supported ? `Permission: ${capability.permission}` : 'Not supported here'}</p></div><button class="btn small-btn" id="notification-btn">${capability.permission === 'granted' ? 'Test' : 'Enable'}</button></section>${incoming.length ? `<div class="section-head"><h2>Nudges</h2><span>${incoming.length}</span></div><div class="nudge-list">${incoming.map((nudge) => `<div class="nudge-row"><b>⚡ ${esc(member(nudge.fromUserId)?.name || 'Friend')}</b><span>${esc(nudge.message)}</span><small>${esc(formatWhen(nudge.createdAt))}</small></div>`).join('')}</div>` : ''}<p class="install">On iPhone: Safari → Share → Add to Home Screen. Donezo will then open full-screen like an app.</p><button class="text-btn danger" id="sign-out">Sign out</button>`;
}

function habitSheet() {
  if (!habitSheetOpen) return '';
  const emojis = ['⚡', '🏃', '🏋️', '📚', '🧠', '📵'];
  return `<div class="sheet-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="Add habit"><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">HABIT SETTINGS</p><h2>Add a habit</h2></div><button class="icon-btn" type="button" data-close-habit aria-label="Close">×</button></div><form id="habit-form" class="form sheet-form"><label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" required autofocus></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" class="emoji ${emoji === selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><label>Target time<input name="targetTime" type="time" value="20:00"></label><label>Proof<select name="proofMode"><option value="none">No proof required</option><option value="photo">Photo / screenshot</option></select></label><button class="btn primary full" ${busy ? 'disabled' : ''}>Add habit</button></form></section></div>`;
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
    return;
  }
  const state = getState();
  if (!state?.circleId) {
    app.innerHTML = onboardingScreen();
    app.querySelector('#create-circle-form')?.addEventListener('submit', handleCreateCircle);
    app.querySelector('#join-circle-form')?.addEventListener('submit', handleJoinCircle);
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
    return;
  }
  const screens = { today: todayScreen, squad: squadScreen, checkin: checkInScreen, league: leagueScreen, me: meScreen };
  app.innerHTML = `<div class="app-shell">${topbar()}<main class="content-scroll" id="content-scroll">${screens[tab]()}</main>${nav()}${habitSheet()}</div>`;
  app.querySelectorAll('[data-tab]').forEach((element) => { element.onclick = () => { tab = element.dataset.tab; habitSheetOpen = false; render(); }; });
  app.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  app.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => handleNudge(element.dataset.nudge); });
  app.querySelectorAll('[data-proof]').forEach((element) => { element.onclick = () => handleProofView(element.dataset.proof); });
  app.querySelectorAll('[data-emoji]').forEach((element) => { element.onclick = () => { selectedEmoji = element.dataset.emoji; render(); }; });
  app.querySelectorAll('[data-profile]').forEach((element) => { element.onclick = () => { tab = 'me'; habitSheetOpen = false; render(); }; });
  app.querySelectorAll('[data-home]').forEach((element) => { element.onclick = () => { tab = 'today'; habitSheetOpen = false; render(); }; });
  app.querySelectorAll('[data-open-habit]').forEach((element) => { element.onclick = () => { tab = 'me'; habitSheetOpen = true; render(); }; });
  app.querySelectorAll('[data-close-habit]').forEach((element) => { element.onclick = () => { habitSheetOpen = false; render(); }; });
  app.querySelector('#habit-form')?.addEventListener('submit', handleAdd);
  app.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
  app.querySelector('#copy-invite')?.addEventListener('click', handleCopyInvite);
  app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
}

async function runMutation(action, successMessage) {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
    if (successMessage) notify(successMessage);
  } catch (error) {
    notify(readableError(error), 3500);
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
        options: { data: { display_name: name }, emailRedirectTo: window.location.origin },
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
  await runMutation(() => repo.createCircle(String(form.get('name'))), 'Circle created');
}

async function handleJoinCircle(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runMutation(() => repo.joinCircle(String(form.get('code'))), 'You joined the circle');
}

async function handleHabit(id) {
  const habit = getState().habits.find((item) => item.id === id);
  if (!habit) return;
  if (done(id)) {
    await runMutation(() => repo.toggleHabit(id, today()), `${habit.title} unchecked`);
    return;
  }
  if (habit.proofMode === 'photo') {
    proofHabit = id;
    proofInput.click();
    return;
  }
  await runMutation(() => repo.toggleHabit(id, today()), `Checked in · ${habit.title}`);
}

async function handleAdd(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get('title'));
  const emoji = selectedEmoji;
  await runMutation(async () => {
    await repo.addHabit({ title, emoji, targetTime: form.get('targetTime'), proofMode: form.get('proofMode'), frequency: 'daily' });
    selectedEmoji = '⚡';
    habitSheetOpen = false;
    tab = 'checkin';
  }, `${emoji} ${title.trim()} added`);
}

async function handleNudge(userId) {
  const friend = member(userId);
  await runMutation(() => repo.sendNudge(userId, 'get moving 💀'), `Nudged ${friend?.name || 'friend'} 💀`);
}

async function handleProofView(path) {
  try {
    const url = await repo.getProofUrl(path);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    notify(readableError(error), 3500);
  }
}

async function handleNotifications() {
  const capability = getNotificationCapability(window);
  if (capability.permission === 'granted') {
    notify(await sendTestNotification() ? 'Test notification sent' : 'Could not send notification');
    return;
  }
  const result = await enableNotifications();
  notify(`Notifications: ${result.permission}`);
  render();
}

async function handleCopyInvite() {
  try {
    await navigator.clipboard.writeText(getState().circleInviteCode);
    notify('Invite code copied');
  } catch {
    notify(`Invite code: ${getState().circleInviteCode}`, 5000);
  }
}

async function handleSignOut() {
  await supabase.auth.signOut();
}

proofInput.addEventListener('change', async () => {
  const file = proofInput.files?.[0];
  const habitId = proofHabit;
  if (!file || !habitId) return;
  proofInput.value = '';
  proofHabit = null;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    notify('Use JPG, PNG, WebP, or HEIC under 4 MB');
    return;
  }
  const habit = getState().habits.find((item) => item.id === habitId);
  await runMutation(() => repo.completeWithProof(habitId, today(), file), `Proof saved · ${habit.title}`);
});

async function boot(nextSession) {
  session = nextSession;
  if (!session) {
    repo = null;
    render();
    return;
  }
  app.innerHTML = '<div class="standalone-screen loading"><div class="brand"><span>ϟ</span><strong>Donezo</strong></div><p>Loading your circle…</p></div>';
  try {
    repo = createSupabaseRepository(supabase, session.user);
    await repo.load();
    render();
  } catch (error) {
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
