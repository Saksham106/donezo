import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { createSupabaseRepository } from './store.js';
import { dailyProgress, calculateStreak, rankMembers } from './domain.js';
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

function topbar(title = 'DONEZO') {
  return `<header class="topbar"><div class="brand"><span>ϟ</span>${title}</div><div class="avatar">${esc(me()?.avatar || '?')}</div></header>`;
}

function nav() {
  const items = [['today', '⌂', 'Today'], ['squad', '◎', 'Squad'], ['add', '+', 'Add'], ['league', '♛', 'League'], ['me', '●', 'Me']];
  return `<nav class="nav">${items.map(([id, icon, label]) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''} ${id === 'add' ? 'add' : ''}"><b>${icon}</b><small>${label}</small></button>`).join('')}</nav>`;
}

function authScreen() {
  const signingUp = authMode === 'sign-up';
  return `<div class="shell auth-shell"><header class="auth-brand"><span>ϟ</span><strong>DONEZO</strong></header><section class="auth-card"><p class="eyebrow">ACCOUNTABILITY WITH FRIENDS</p><h1>${signingUp ? 'Start showing up.' : 'Welcome back.'}</h1><p>${signingUp ? 'Create your account, then make or join a circle.' : 'Your habits and your people are waiting.'}</p>${authMessage ? `<div class="form-message">${esc(authMessage)}</div>` : ''}<form id="auth-form" class="form auth-form">${signingUp ? '<label>Name<input name="name" autocomplete="name" maxlength="60" required placeholder="Saksham"></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="8+ characters"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : signingUp ? 'Create account' : 'Sign in'}</button></form><button class="text-btn" id="auth-mode">${signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></div>`;
}

function onboardingScreen() {
  return `<div class="shell"><header class="topbar"><div class="brand"><span>ϟ</span>DONEZO</div><button class="text-btn compact" id="sign-out">Sign out</button></header><section class="hero"><p class="eyebrow">ONE LAST STEP</p><h1>Bring your people<br>into the circle.</h1><p>Create a squad or enter the invite code a friend sent you.</p></section><div class="onboard-grid"><form id="create-circle-form" class="form"><h2>Create a circle</h2><label>Circle name<input name="name" maxlength="60" required placeholder="Donezo Crew"></label><button class="btn primary full" ${busy ? 'disabled' : ''}>Create circle</button></form><div class="or"><span>OR</span></div><form id="join-circle-form" class="form"><h2>Join friends</h2><label>12-character invite code<input name="code" minlength="12" maxlength="12" autocapitalize="none" required placeholder="a1b2c3d4e5f6"></label><button class="btn full" ${busy ? 'disabled' : ''}>Join circle</button></form></div></div>`;
}

function habitCard(habit) {
  const isDone = done(habit.id);
  return `<button class="habit ${isDone ? 'done' : ''}" data-habit="${habit.id}" ${busy ? 'disabled' : ''}><span class="habit-icon">${esc(habit.emoji)}</span><span class="habit-copy"><strong>${esc(habit.title)}</strong><small>${habit.targetTime || 'Any time'} · <em>+${habit.xp} XP</em>${habit.proofMode === 'photo' ? ' · PHOTO' : ''}</small></span><span class="check">${isDone ? '✓' : ''}</span></button>`;
}

function todayScreen() {
  const state = getState();
  const habits = state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
  const completed = habits.filter((habit) => done(habit.id)).length;
  const progress = dailyProgress(completed, habits.length);
  const dates = [...new Set(state.checkIns.filter((checkIn) => checkIn.userId === state.currentUserId).map((checkIn) => checkIn.date))];
  const streak = calculateStreak(dates, today());
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const list = habits.length ? habits.map(habitCard).join('') : '<div class="empty"><b>No habits yet.</b><p>Tap Add and make the first promise measurable.</p></div>';
  return `${topbar()}<section class="hero"><p class="eyebrow">TODAY · KEEP THE STREAK ALIVE</p><h1>${greeting},<br>${esc(me().name)}.</h1><p>Your squad can see the scoreboard. Finish the day strong.</p></section><section class="progress"><div><strong>${completed}<span>/${habits.length}</span></strong><small>habits done today</small></div><div class="pill">🔥 ${streak} day streak</div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Today</h2><span>${progress.percent}% complete</span></div><div class="list">${list}</div>${nav()}`;
}

function squadScreen() {
  const state = getState();
  const activities = state.friendActivities.map((activity) => {
    const actor = member(activity.userId);
    return `<article class="activity"><div class="activity-head"><div class="avatar">${esc(actor?.avatar || '?')}</div><div><strong>${esc(actor?.name || 'Friend')} locked in</strong><small>${esc(formatWhen(activity.when))} · ${activity.streak} check-in days</small></div></div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${activity.proofPath ? `<button class="btn proof-btn" data-proof="${esc(activity.proofPath)}">View proof</button>` : ''}</article>`;
  }).join('');
  const friends = state.members.filter((item) => item.id !== state.currentUserId);
  const friendRows = friends.map((friend) => `<div class="friend-row"><div class="avatar">${esc(friend.avatar)}</div><span><strong>${esc(friend.name)}</strong><small>${friend.xp} XP</small></span><button class="btn" data-nudge="${friend.id}" ${busy ? 'disabled' : ''}>Nudge</button></div>`).join('');
  return `${topbar('SQUAD')}<section class="hero"><p class="eyebrow">${esc(state.circleName)}</p><h1>Your people.<br>Your pressure.</h1><p>Celebrate wins. Call out misses. No silent quitting.</p></section><div class="section-head"><h2>Friends</h2><span>${friends.length}</span></div><div class="list">${friendRows || '<div class="empty"><b>It is quiet in here.</b><p>Share your invite code from Me.</p></div>'}</div><div class="section-head"><h2>Recent wins</h2><span>${state.friendActivities.length}</span></div><div class="list">${activities || '<div class="empty"><b>No check-ins yet.</b><p>The feed fills up when friends complete habits.</p></div>'}</div>${nav()}`;
}

function addScreen() {
  const emojis = ['⚡', '🏃', '🏋️', '📚', '🧠', '📵'];
  return `${topbar('NEW HABIT')}<section class="hero"><p class="eyebrow">MAKE IT MEASURABLE</p><h1>What are you<br>locking in?</h1></section><form id="habit-form" class="form"><label>Habit name<input name="title" maxlength="80" placeholder="Run 1 mile" required></label><label>Icon<div class="emoji-row">${emojis.map((emoji) => `<button type="button" data-emoji="${emoji}" class="emoji ${emoji === selectedEmoji ? 'selected' : ''}">${emoji}</button>`).join('')}</div></label><div class="two"><label>Target time<input name="targetTime" type="time" value="20:00"></label><label>XP<select name="xp"><option>10</option><option>15</option><option selected>20</option><option>25</option></select></label></div><label>Proof<select name="proofMode"><option value="none">Trust me</option><option value="photo">Photo / screenshot</option></select></label><button class="btn primary full" ${busy ? 'disabled' : ''}>Add to my daily list</button></form>${nav()}`;
}

function leagueScreen() {
  const ranked = rankMembers(getState().members);
  const mine = ranked.find((item) => item.id === me().id);
  const leader = ranked[0];
  return `${topbar('LEAGUE')}<section class="hero"><p class="eyebrow">CURRENT SCOREBOARD</p><h1>Friendly competition.<br>Unfriendly scoreboard.</h1></section><div class="league-summary"><b>#${mine.rank} · ${mine.xp} XP</b><small>${leader.id === mine.id ? 'You are on top.' : `${leader.xp - mine.xp} XP behind ${leader.name}.`}</small></div><div class="list">${ranked.map((item) => `<div class="league-row ${item.id === me().id ? 'mine' : ''}"><b>${item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`}</b><div class="avatar">${esc(item.avatar)}</div><span><strong>${esc(item.name)}</strong><small>🔥 ${item.currentStreak} check-in days</small></span><strong>${item.xp} XP</strong></div>`).join('')}</div>${nav()}`;
}

function meScreen() {
  const state = getState();
  const capability = getNotificationCapability(window);
  const total = state.checkIns.filter((checkIn) => checkIn.userId === me().id).length;
  const incoming = state.nudges.filter((nudge) => nudge.toUserId === me().id).slice(0, 5);
  return `${topbar('ME')}<section class="hero"><p class="eyebrow">${esc(me().handle || session.user.email)}</p><h1>${esc(me().name)}</h1><p>Proof beats promises.</p></section><div class="stats"><div><b>${me().xp}</b><small>Total XP</small></div><div><b>${state.members.length}</b><small>Circle members</small></div><div><b>${total}</b><small>Check-ins</small></div><div><b>🔥</b><small>Keep going</small></div></div><section class="settings invite"><div><strong>Invite friends</strong><p>Circle code: <code>${esc(state.circleInviteCode)}</code></p></div><button class="btn" id="copy-invite">Copy</button></section><section class="settings"><div><strong>Push notifications</strong><p>${capability.supported ? `Permission: ${capability.permission}` : 'Not supported here'}</p></div><button class="btn primary" id="notification-btn">${capability.permission === 'granted' ? 'Test' : 'Enable'}</button></section>${incoming.length ? `<div class="section-head"><h2>Nudges</h2><span>${incoming.length}</span></div><div class="list">${incoming.map((nudge) => `<div class="nudge-row"><b>⚡ ${esc(member(nudge.fromUserId)?.name || 'Friend')}</b><span>${esc(nudge.message)}</span><small>${esc(formatWhen(nudge.createdAt))}</small></div>`).join('')}</div>` : ''}<button class="text-btn danger" id="sign-out">Sign out</button><p class="install">On iPhone: Safari → Share → Add to Home Screen, then open Donezo from your Home Screen.</p>${nav()}`;
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
  const screens = { today: todayScreen, squad: squadScreen, add: addScreen, league: leagueScreen, me: meScreen };
  app.innerHTML = `<div class="shell">${screens[tab]()}</div>`;
  app.querySelectorAll('[data-tab]').forEach((element) => { element.onclick = () => { tab = element.dataset.tab; render(); }; });
  app.querySelectorAll('[data-habit]').forEach((element) => { element.onclick = () => handleHabit(element.dataset.habit); });
  app.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => handleNudge(element.dataset.nudge); });
  app.querySelectorAll('[data-proof]').forEach((element) => { element.onclick = () => handleProofView(element.dataset.proof); });
  app.querySelectorAll('[data-emoji]').forEach((element) => { element.onclick = () => { selectedEmoji = element.dataset.emoji; render(); }; });
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
  await runMutation(() => repo.toggleHabit(id, today()), `+${habit.xp} XP · ${habit.title}`);
}

async function handleAdd(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get('title'));
  const emoji = selectedEmoji;
  await runMutation(async () => {
    await repo.addHabit({ title, emoji, targetTime: form.get('targetTime'), xp: form.get('xp'), proofMode: form.get('proofMode'), frequency: 'daily' });
    selectedEmoji = '⚡';
    tab = 'today';
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
  await runMutation(() => repo.completeWithProof(habitId, today(), file), `Proof saved · +${habit.xp} XP`);
});

async function boot(nextSession) {
  session = nextSession;
  if (!session) {
    repo = null;
    render();
    return;
  }
  app.innerHTML = '<div class="shell loading"><div class="brand"><span>ϟ</span>DONEZO</div><p>Loading your circle…</p></div>';
  try {
    repo = createSupabaseRepository(supabase, session.user);
    await repo.load();
    render();
  } catch (error) {
    app.innerHTML = `<div class="shell loading"><div class="brand"><span>ϟ</span>DONEZO</div><h1>Could not load.</h1><p>${esc(readableError(error))}</p><button class="btn primary" id="retry">Retry</button><button class="text-btn" id="sign-out">Sign out</button></div>`;
    app.querySelector('#retry')?.addEventListener('click', () => boot(session));
    app.querySelector('#sign-out')?.addEventListener('click', handleSignOut);
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const { data: { session: initialSession } } = await supabase.auth.getSession();
await boot(initialSession);
supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event === 'TOKEN_REFRESHED') return;
  queueMicrotask(() => boot(nextSession));
});
