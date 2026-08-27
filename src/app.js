import { createDemoState } from './demo-data.js';
import { createLocalRepository } from './store.js';
import { dailyProgress, calculateStreak, rankMembers } from './domain.js';
import { enableNotifications, getNotificationCapability, sendTestNotification } from './notifications.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const proofInput = document.querySelector('#proof-input');
const now = new Date();
const today = now.toLocaleDateString('en-CA');
const repo = createLocalRepository(createDemoState(today));
let tab = 'today';
let proofHabit = null;
let selectedEmoji = '⚡';

const getState = () => repo.getState();
const me = () => getState().members.find((m) => m.id === getState().currentUserId);
const member = (id) => getState().members.find((m) => m.id === id);
const done = (habitId) => getState().checkIns.some((c) => c.habitId === habitId && c.userId === me().id && c.date === today);
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function topbar(title = 'DONEZO') {
  return `<header class="topbar"><div class="brand"><span>ϟ</span>${title}</div><div class="avatar">${esc(me().avatar)}</div></header>`;
}

function nav() {
  const items = [['today','⌂','Today'],['squad','◎','Squad'],['add','+','Add'],['league','♛','League'],['me','●','Me']];
  return `<nav class="nav">${items.map(([id, icon, label]) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''} ${id === 'add' ? 'add' : ''}"><b>${icon}</b><small>${label}</small></button>`).join('')}</nav>`;
}

function habitCard(h) {
  const isDone = done(h.id);
  return `<button class="habit ${isDone ? 'done' : ''}" data-habit="${h.id}"><span class="habit-icon">${h.emoji}</span><span class="habit-copy"><strong>${esc(h.title)}</strong><small>${h.targetTime || 'Any time'} · <em>+${h.xp} XP</em>${h.proofMode === 'photo' ? ' · PHOTO' : ''}</small></span><span class="check">${isDone ? '✓' : ''}</span></button>`;
}

function todayScreen() {
  const s = getState();
  const habits = s.habits.filter((h) => h.ownerId === s.currentUserId && h.active);
  const completed = habits.filter((h) => done(h.id)).length;
  const progress = dailyProgress(completed, habits.length);
  const dates = [...new Set(s.checkIns.filter((c) => c.userId === s.currentUserId).map((c) => c.date))];
  const streak = calculateStreak(dates, today) || me().currentStreak;
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  return `${topbar()}<section class="hero"><p class="eyebrow">TODAY · KEEP THE STREAK ALIVE</p><h1>${greeting},<br>${esc(me().name)}.</h1><p>Your squad can see the scoreboard. Finish the day strong.</p></section><section class="progress"><div><strong>${completed}<span>/${habits.length}</span></strong><small>habits done today</small></div><div class="pill">🔥 ${streak} day streak</div><div class="bar"><i style="width:${progress.percent}%"></i></div></section><div class="section-head"><h2>Today</h2><span>${progress.percent}% complete</span></div><div class="list">${habits.map(habitCard).join('')}</div>${nav()}`;
}

function squadScreen() {
  const s = getState();
  const cards = s.friendActivities.map((a) => {
    const m = member(a.userId); const overdue = a.type === 'overdue';
    return `<article class="activity ${overdue ? 'overdue' : ''}"><div class="activity-head"><div class="avatar">${m.avatar}</div><div><strong>${esc(m.name)} ${overdue ? 'is slipping' : 'locked in'}</strong><small>${esc(a.when)}${overdue ? '' : ' ago'} · ${a.streak} day streak</small></div></div><div class="activity-body"><span>${a.emoji}</span><div><strong>${esc(a.habitTitle)}</strong><p>${esc(a.message)}</p></div></div>${overdue ? `<button class="btn primary" data-nudge="${m.id}">Nudge ${esc(m.name)}</button>` : '<div class="reactions">🔥 &nbsp; 👏 &nbsp; 💀</div>'}</article>`;
  }).join('');
  return `${topbar('SQUAD')}<section class="hero"><p class="eyebrow">${esc(s.circleName)}</p><h1>Your people.<br>Your pressure.</h1><p>Celebrate wins. Call out misses. No silent quitting.</p></section><div class="section-head"><h2>Live feed</h2><span>${s.members.length} friends</span></div><div class="list">${cards}</div>${nav()}`;
}

function addScreen() {
  const emojis = ['⚡','🏃','🏋️','📚','🧠','📵'];
  return `${topbar('NEW HABIT')}<section class="hero"><p class="eyebrow">MAKE IT MEASURABLE</p><h1>What are you<br>locking in?</h1></section><form id="habit-form" class="form"><label>Habit name<input name="title" maxlength="42" placeholder="Run 1 mile" required></label><label>Icon<div class="emoji-row">${emojis.map((e) => `<button type="button" data-emoji="${e}" class="emoji ${e === selectedEmoji ? 'selected' : ''}">${e}</button>`).join('')}</div></label><div class="two"><label>Target time<input name="targetTime" type="time" value="20:00"></label><label>XP<select name="xp"><option>10</option><option>15</option><option selected>20</option><option>25</option></select></label></div><label>Proof<select name="proofMode"><option value="none">Trust me</option><option value="photo">Photo / screenshot</option></select></label><button class="btn primary full">Add to my daily list</button></form>${nav()}`;
}

function leagueScreen() {
  const ranked = rankMembers(getState().members); const mine = ranked.find((m) => m.id === me().id); const leader = ranked[0];
  return `${topbar('LEAGUE')}<section class="hero"><p class="eyebrow">WEEKLY LEAGUE</p><h1>Friendly competition.<br>Unfriendly scoreboard.</h1></section><div class="league-summary"><b>#${mine.rank} · ${mine.xp} XP</b><small>${leader.id === mine.id ? 'You are on top.' : `${leader.xp - mine.xp} XP behind ${leader.name}.`}</small></div><div class="list">${ranked.map((m) => `<div class="league-row ${m.id === me().id ? 'mine' : ''}"><b>${m.rank === 1 ? '🥇' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : `#${m.rank}`}</b><div class="avatar">${m.avatar}</div><span><strong>${esc(m.name)}</strong><small>🔥 ${m.currentStreak} day streak</small></span><strong>${m.xp} XP</strong></div>`).join('')}</div>${nav()}`;
}

function meScreen() {
  const s = getState(); const cap = getNotificationCapability(window); const total = s.checkIns.filter((c) => c.userId === me().id).length;
  return `${topbar('ME')}<section class="hero"><p class="eyebrow">${esc(me().handle)}</p><h1>${esc(me().name)}</h1><p>Proof beats promises.</p></section><div class="stats"><div><b>🔥 ${me().currentStreak}</b><small>Current streak</small></div><div><b>${me().bestStreak}</b><small>Best streak</small></div><div><b>${me().xp}</b><small>Weekly XP</small></div><div><b>${total}</b><small>Check-ins</small></div></div><section class="settings"><div><strong>Push notifications</strong><p>${cap.supported ? `Permission: ${cap.permission}` : 'Not supported here'}</p></div><button class="btn primary" id="notification-btn">${cap.permission === 'granted' ? 'Test' : 'Enable'}</button></section><p class="install">On iPhone: Safari → Share → Add to Home Screen, then open Donezo from your Home Screen and enable notifications.</p>${nav()}`;
}

function render() {
  app.innerHTML = `<div class="shell">${tab === 'today' ? todayScreen() : tab === 'squad' ? squadScreen() : tab === 'add' ? addScreen() : tab === 'league' ? leagueScreen() : meScreen()}</div>`;
  app.querySelectorAll('[data-tab]').forEach((el) => el.onclick = () => { tab = el.dataset.tab; render(); });
  app.querySelectorAll('[data-habit]').forEach((el) => el.onclick = () => handleHabit(el.dataset.habit));
  app.querySelectorAll('[data-nudge]').forEach((el) => el.onclick = () => { const m = member(el.dataset.nudge); repo.sendNudge(m.id, 'get moving 💀'); notify(`Nudged ${m.name} 💀`); });
  app.querySelectorAll('[data-emoji]').forEach((el) => el.onclick = () => { selectedEmoji = el.dataset.emoji; render(); });
  app.querySelector('#habit-form')?.addEventListener('submit', handleAdd);
  app.querySelector('#notification-btn')?.addEventListener('click', handleNotifications);
}

function handleHabit(id) {
  const h = getState().habits.find((x) => x.id === id); if (!h) return;
  if (done(id)) { repo.toggleHabit(id, today); notify(`${h.title} unchecked`); render(); return; }
  if (h.proofMode === 'photo') { proofHabit = id; proofInput.click(); return; }
  repo.toggleHabit(id, today); notify(`+${h.xp} XP · ${h.title}`); render();
}

function handleAdd(event) {
  event.preventDefault(); const f = new FormData(event.currentTarget);
  const h = repo.addHabit({ title: f.get('title'), emoji: selectedEmoji, targetTime: f.get('targetTime'), xp: f.get('xp'), proofMode: f.get('proofMode'), frequency: 'daily' });
  selectedEmoji = '⚡'; tab = 'today'; notify(`${h.emoji} ${h.title} added`); render();
}

async function handleNotifications() {
  const cap = getNotificationCapability(window);
  if (cap.permission === 'granted') { notify(await sendTestNotification() ? 'Test notification sent' : 'Could not send notification'); return; }
  const result = await enableNotifications(); notify(`Notifications: ${result.permission}`); render();
}

proofInput.addEventListener('change', () => {
  const file = proofInput.files?.[0]; if (!file || !proofHabit) return;
  if (!file.type.startsWith('image/') || file.size > 4 * 1024 * 1024) { notify('Use an image under 4 MB'); return; }
  const reader = new FileReader(); reader.onload = () => { const h = getState().habits.find((x) => x.id === proofHabit); repo.completeWithProof(proofHabit, today, String(reader.result)); proofHabit = null; proofInput.value = ''; notify(`Proof saved · +${h.xp} XP`); render(); }; reader.readAsDataURL(file);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
