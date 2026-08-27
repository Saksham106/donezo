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

function topbar(title = 'Donezo') {
  return `<header class="topbar"><div class="brand"><span class="brand-mark">D</span><span class="brand-word">${esc(title)}</span></div><div class="avatar" aria-label="${esc(me().name)}">${esc(me().avatar)}</div></header>`;
}

function nav() {
  const items = [['today','⌂','Today'],['squad','◎','Squad'],['add','+','Add'],['league','♛','League'],['me','●','Me']];
  return `<nav class="nav" aria-label="Primary">${items.map(([id, icon, label]) => `<button type="button" aria-label="${label}" ${tab === id ? 'aria-current="page"' : ''} data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''} ${id === 'add' ? 'add' : ''}"><b aria-hidden="true">${icon}</b><small>${label}</small></button>`).join('')}</nav>`;
}

function habitCard(h) {
  const isDone = done(h.id);
  const proof = h.proofMode === 'photo' ? '<span class="proof-tag">Proof</span>' : '';
  return `<button type="button" class="habit ${isDone ? 'done' : ''}" data-habit="${h.id}" aria-pressed="${isDone}"><span class="habit-icon" aria-hidden="true">${h.emoji}</span><span class="habit-copy"><strong>${esc(h.title)}</strong><span class="habit-meta"><span>${h.targetTime || 'Any time'}</span><span class="xp-tag">+${h.xp} XP</span>${proof}</span></span><span class="check" aria-hidden="true">${isDone ? '✓' : ''}</span></button>`;
}

function todayScreen() {
  const s = getState();
  const habits = s.habits.filter((h) => h.ownerId === s.currentUserId && h.active);
  const completed = habits.filter((h) => done(h.id)).length;
  const remaining = Math.max(0, habits.length - completed);
  const progress = dailyProgress(completed, habits.length);
  const dates = [...new Set(s.checkIns.filter((c) => c.userId === s.currentUserId).map((c) => c.date))];
  const streak = calculateStreak(dates, today) || me().currentStreak;
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  return `${topbar()}<section class="hero hero-today"><h1>${greeting},<br>${esc(me().name)}.</h1><p>Your friends can see the scoreboard. Finish what you said you would.</p></section><section class="daily-score"><div class="score-top"><div class="score-number"><span>Today's score</span><strong>${completed}<em>/${habits.length}</em></strong></div><div class="streak-block"><span aria-hidden="true">🔥</span><div><b>${streak} days</b><small>current streak</small></div></div></div><div class="score-progress"><div class="bar"><i style="width:${progress.percent}%"></i></div><span>${progress.percent}%</span></div></section><div class="section-head"><h2>Today's lineup</h2><span>${remaining ? `${remaining} left` : 'Donezo.'}</span></div><div class="habit-list">${habits.map(habitCard).join('')}</div>${nav()}`;
}

function squadScreen() {
  const s = getState();
  const cards = s.friendActivities.map((a) => {
    const m = member(a.userId); const overdue = a.type === 'overdue';
    return `<article class="activity ${overdue ? 'overdue' : ''}"><div class="activity-head"><div class="avatar">${m.avatar}</div><div class="activity-person"><strong>${esc(m.name)}</strong><small>${esc(a.when)}${overdue ? '' : ' ago'} · ${a.streak} day streak</small></div><span class="activity-state">${overdue ? 'Needs a nudge' : 'Checked in'}</span></div><div class="activity-body"><span class="activity-icon" aria-hidden="true">${a.emoji}</span><div><strong>${esc(a.habitTitle)}</strong><p>${esc(a.message)}</p></div></div>${overdue ? `<button type="button" class="btn primary" data-nudge="${m.id}">Nudge ${esc(m.name)}</button>` : '<div class="reactions" aria-label="Reactions"><span>🔥</span><span>👏</span><span>💀</span></div>'}</article>`;
  }).join('');
  return `${topbar('Squad')}<section class="hero"><span class="context-chip social">${esc(s.circleName)}</span><h1>Your people.<br>Your pressure.</h1><p>Wins are public. Misses are public. That is kind of the point.</p></section><div class="section-head"><h2>Squad feed</h2><span>${s.members.length} friends</span></div><div class="feed">${cards}</div>${nav()}`;
}

function addScreen() {
  const emojis = ['⚡','🏃','🏋️','📚','🧠','📵'];
  return `${topbar('New habit')}<section class="hero"><h1>What are you<br>locking in?</h1><p>Make it specific enough that your friends know when you did it — and when you didn't.</p></section><form id="habit-form" class="form"><label class="field"><span class="field-label">Habit name</span><input name="title" maxlength="42" placeholder="Run 1 mile" required></label><fieldset class="field emoji-field"><legend class="field-label">Icon</legend><div class="emoji-row">${emojis.map((e) => `<button type="button" aria-pressed="${e === selectedEmoji}" data-emoji="${e}" class="emoji ${e === selectedEmoji ? 'selected' : ''}">${e}</button>`).join('')}</div></fieldset><div class="two"><label class="field"><span class="field-label">Target time</span><input name="targetTime" type="time" value="20:00"></label><label class="field"><span class="field-label">Points</span><select name="xp"><option>10</option><option>15</option><option selected>20</option><option>25</option></select></label></div><label class="field"><span class="field-label">Proof</span><select name="proofMode"><option value="none">Trust me</option><option value="photo">Photo / screenshot</option></select></label><button class="btn primary full">Add to today's lineup</button></form>${nav()}`;
}

function leagueScreen() {
  const ranked = rankMembers(getState().members); const mine = ranked.find((m) => m.id === me().id); const leader = ranked[0];
  return `${topbar('League')}<section class="hero"><h1>Friendly competition.<br>Unfriendly scoreboard.</h1><p>The board resets weekly. Your excuses do not.</p></section><section class="league-summary"><div><span>Your rank</span><strong>#${mine.rank}</strong></div><div class="league-gap"><b>${mine.xp} XP</b><small>${leader.id === mine.id ? 'You are on top.' : `${leader.xp - mine.xp} XP behind ${leader.name}.`}</small></div></section><div class="section-head"><h2>This week</h2><span>Resets Sunday</span></div><div class="leaderboard">${ranked.map((m) => `<div class="league-row rank-${m.rank} ${m.id === me().id ? 'mine' : ''}"><span class="league-rank">${m.rank === 1 ? '🥇' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : `#${m.rank}`}</span><div class="avatar">${m.avatar}</div><span class="league-person"><strong>${esc(m.name)}</strong><small>🔥 ${m.currentStreak} day streak</small></span><strong class="league-xp">${m.xp}<small>XP</small></strong></div>`).join('')}</div>${nav()}`;
}

function meScreen() {
  const s = getState(); const cap = getNotificationCapability(window); const total = s.checkIns.filter((c) => c.userId === me().id).length;
  return `${topbar('Me')}<section class="profile-hero"><div class="avatar avatar-xl">${esc(me().avatar)}</div><div><h1>${esc(me().name)}</h1><p>${esc(me().handle)} · Proof beats promises.</p></div></section><div class="stats"><div><b>🔥 ${me().currentStreak}</b><small>Current streak</small></div><div><b>${me().bestStreak}</b><small>Best streak</small></div><div><b>${me().xp}</b><small>Weekly XP</small></div><div><b>${total}</b><small>Check-ins</small></div></div><div class="section-head"><h2>App</h2><span>Make Donezo useful</span></div><section class="settings"><div><strong>Push notifications</strong><p>${cap.supported ? `Permission: ${cap.permission}` : 'Not supported here'}</p></div><button type="button" class="btn secondary" id="notification-btn">${cap.permission === 'granted' ? 'Test' : 'Enable'}</button></section><p class="install">On iPhone: Safari → Share → Add to Home Screen, then open Donezo from your Home Screen and enable notifications.</p>${nav()}`;
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
