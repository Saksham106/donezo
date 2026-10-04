// Profile: identity header, habits, this week's history strip, milestones
// and monthly Wrapped. Settings open from the gear.
import { BADGE_CATALOG } from '../domain.js';
import { habitPausedOn, historyEntries, myHabits, shiftDate, weekBounds, weekStrip } from '../today-domain.js';
import { getState, me, member, today, ui } from './state.js';
import { avatar, esc, formatDay, formatExactTime, formatTime, icon } from './util.js';
import { render } from './render.js';
import { openRecovery } from './social.js';
import { handleShareInvite } from './people.js';
import { bindProofThumbnails } from './home.js';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleLabel(habit) {
  const frequency = habit.scheduleFrequency || habit.frequency || 'daily';
  if (frequency === 'times_per_week') return `${habit.weeklyTargetDays ?? 1}× a week`;
  if (frequency === 'weekly') return `Weekly${habit.scheduleWeekdays?.length ? ` · ${WEEKDAY_SHORT[habit.scheduleWeekdays[0]]}` : ''}`;
  if (frequency === 'selected_weekdays') return (habit.scheduleWeekdays || []).map((day) => WEEKDAY_SHORT[day]).join(', ') || 'Specific days';
  return 'Daily';
}

function habitRow(habit) {
  const date = today();
  const pause = (habit.pauseWindows || []).find((item) => item.startDate <= date && date <= item.endDate);
  const sub = pause
    ? `Paused until ${formatDay(pause.endDate, { month: 'short', day: 'numeric' })}`
    : `${scheduleLabel(habit)}${habit.targetTime ? ` · ${formatTime(habit.targetTime)}` : ''} · ${habit.proofMode === 'photo' ? 'photo proof' : 'honor system'}`;
  return `<button type="button" class="dz-habit-row ${habitPausedOn(habit, date) ? 'paused' : ''}" data-edit-habit="${habit.id}" aria-label="Edit ${esc(habit.title)}"><span class="dz-tile">${esc(habit.emoji)}</span><span class="dz-row-copy"><strong>${esc(habit.title)}</strong><small>${esc(sub)}</small></span>${icon('chevron', 16, 2.2)}</button>`;
}

/** Check-ins and recoveries for the history list, newest first. */
function historyItems({ from = null, to = null } = {}) {
  const state = getState();
  const habits = new Map(state.habits.map((habit) => [habit.id, habit]));
  const checkIns = historyEntries(state, state.currentUserId, { from, to }).map((item) => ({
    kind: item.invalid ? 'rejected' : 'completed',
    date: item.date,
    when: item.completedAt || `${item.date}T12:00:00Z`,
    habit: habits.get(item.habitId),
    proofPath: item.proofPath || null,
  }));
  const recoveries = (state.recoveries || [])
    .filter((item) => habits.get(item.habitId)?.ownerId === state.currentUserId && (!from || item.missedDate >= from) && (!to || item.missedDate <= to))
    .map((item) => ({ kind: 'recovered', date: item.missedDate, when: item.createdAt || `${item.missedDate}T12:00:00Z`, habit: habits.get(item.habitId), proofPath: null }));
  return [...checkIns, ...recoveries].filter((item) => item.habit).sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

function historyRow(item) {
  const label = { completed: 'Completed', recovered: 'Recovered', rejected: 'Rejected' }[item.kind];
  const thumb = item.proofPath
    ? `<span class="dz-thumb" data-proof-image="${esc(item.proofPath)}"></span>`
    : `<span class="dz-thumb emoji">${esc(item.habit.emoji)}</span>`;
  const time = item.kind === 'recovered' ? `${formatDay(item.date, { weekday: 'short' })} · bounce back` : `${formatDay(item.date)}${item.kind === 'completed' && item.when.includes('T') ? ` · ${formatExactTime(item.when)}` : ''}`;
  return `<div class="dz-history-row">${thumb}<span class="dz-row-copy"><strong>${esc(item.habit.title)}</strong><small>${esc(time)}</small></span><span class="dz-pill ${item.kind}">${label}</span></div>`;
}

function historySection() {
  const strip = weekStrip(getState(), getState().currentUserId, today());
  const yesterday = shiftDate(today(), -1);
  const days = strip.map((day) => {
    const tappable = day.status === 'missed' && day.date === yesterday;
    const attrs = tappable ? `data-strip-missed="${day.date}" aria-label="Bounce back from ${esc(formatDay(day.date))}"` : `aria-label="${esc(formatDay(day.date))}: ${day.status}"`;
    return `<${tappable ? 'button type="button"' : 'div'} class="dz-day ${day.status}" ${attrs}><small>${day.label}</small><span>${day.day}</span></${tappable ? 'button' : 'div'}>`;
  }).join('');
  const latest = historyItems().slice(0, 2).map(historyRow).join('');
  return `<section class="dz-section"><div class="dz-section-head"><h2>History</h2><button type="button" class="dz-link" data-history-open>See all</button></div><div class="dz-week-strip">${days}</div>${latest || '<p class="dz-fine">Your check-ins will show up here.</p>'}</section>`;
}

function earnedBadges() {
  return ui.repo.getEarnedBadges({ asOfDate: today(), timeZone: me()?.timeZone || 'UTC' });
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

function monthlyWrapped() {
  return ui.repo.getMonthlyWrapped(previousMonthKey(), { asOfDate: today(), timeZone: me()?.timeZone || 'UTC', recapOptOut: me()?.awardOptOut });
}

function badgeIcon(category) {
  return ({ streak: '🔥', completion: '✓', consistency: '◆', variety: '✦', proof: '🧾', baton: '↗', longevity: '⌛' })[category] || '✦';
}

export function profileScreen() {
  const person = me();
  const habits = myHabits(getState());
  const badges = earnedBadges();
  const wrapped = monthlyWrapped();
  const handle = person.handle || (person.username ? `@${person.username}` : ui.session?.user?.email || '');
  const badgeDots = badges.slice(-3).reverse().map((badge) => `<span class="dz-badge-dot" title="${esc(badge.name)}">${badgeIcon(badge.category)}</span>`).join('');
  const wrappedRow = wrapped.summary.completionCount
    ? `<button type="button" class="dz-link-row" data-wrapped-open><span class="dz-wrapped-thumb" aria-hidden="true"></span><span class="dz-row-copy"><strong>${esc(monthLabel(wrapped.period.month).split(' ')[0])}, Wrapped</strong><small>${wrapped.summary.completionCount} check-ins · friend awards</small></span>${icon('chevron', 16, 2.2)}</button>`
    : '';
  return `<header class="dz-header end"><button type="button" class="dz-icon-btn" data-settings aria-label="Settings">${icon('sliders', 20)}</button></header><section class="dz-profile-head"><div class="dz-profile-id">${avatar(person, 72)}<div class="dz-row-copy"><h1>${esc(person.name)}</h1>${handle ? `<span>${esc(handle)}</span>` : ''}<span class="dz-streak">${icon('bolt', 14, 2.2)} ${person.currentStreak || 0}-day streak</span></div></div><div class="dz-btn-row"><button type="button" class="dz-btn secondary" data-edit-profile>Edit profile</button><button type="button" class="dz-btn secondary" data-share-profile>${icon('share', 16, 2)} Share profile</button></div></section><section class="dz-section"><div class="dz-section-head"><h2>Habits</h2><button type="button" class="dz-link" data-open-habit>+ Add</button></div>${habits.length ? habits.map(habitRow).join('') : '<p class="dz-fine">No habits yet. Add one thing worth showing up for.</p>'}</section>${historySection()}<button type="button" class="dz-link-row" data-badge-cabinet><span class="dz-row-copy"><strong class="big">Milestones</strong></span><span class="dz-badge-dots">${badgeDots}</span><small>${badges.length} of ${BADGE_CATALOG.length}</small>${icon('chevron', 16, 2.2)}</button>${wrappedRow}`;
}

// --- Sheets ----------------------------------------------------------------------

export function historySheet() {
  if (!ui.historyOpen) return '';
  const range = ui.historyRange === 'month' ? 'month' : 'week';
  const from = range === 'week' ? weekBounds(today()).start : `${today().slice(0, 7)}-01`;
  const items = historyItems({ from, to: today() });
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  });
  const content = [...groups.entries()].map(([date, rows]) => `<section class="dz-sheet-section"><h3>${esc(formatDay(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</h3>${rows.map(historyRow).join('')}</section>`).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall" role="dialog" aria-modal="true" aria-label="History" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>History</h2></div><button class="icon-btn" type="button" data-close-history aria-label="Close">×</button></div><div class="dz-segmented"><button type="button" class="${range === 'week' ? 'active' : ''}" data-history-range="week">This week</button><button type="button" class="${range === 'month' ? 'active' : ''}" data-history-range="month">This month</button></div>${content || '<div class="dz-empty"><p>No check-ins in this range yet.</p></div>'}<p class="dz-fine center">Showing your most recent 1,000 check-ins.</p></section></div>`;
}

export function badgeCabinet() {
  if (!ui.badgeCabinetOpen) return '';
  const unlocked = new Map(earnedBadges().map((badge) => [badge.id, badge]));
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall badge-cabinet" role="dialog" aria-modal="true" aria-label="Milestones" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Milestones</h2></div><button class="icon-btn" type="button" data-close-badges aria-label="Close">×</button></div><p class="sheet-copy">Monthly awards reset. These stay forever.</p><div class="dz-badge-grid">${BADGE_CATALOG.map((badge) => { const item = unlocked.get(badge.id); return `<article class="dz-badge-tile ${item ? 'earned' : 'locked'}"><i aria-hidden="true">${item ? badgeIcon(badge.category) : '·'}</i><strong>${esc(badge.name)}</strong><p>${esc(badge.description)}</p><small>${item ? `Unlocked ${esc(item.earnedAt)}` : 'Locked'}</small></article>`; }).join('')}</div></section></div>`;
}

function wrappedSlide(screen, wrapped) {
  if (screen.kind === 'cover') return `<div class="wrapped-slide cover"><small>${esc(monthLabel(wrapped.period.month).toUpperCase())}</small><h2>Your friends showed up.</h2><p>Here is the month in five quick taps.</p></div>`;
  if (screen.kind === 'summary') return `<div class="wrapped-slide"><small>THE NUMBERS</small><h2>${screen.completionCount}</h2><p>valid check-ins from ${screen.activeParticipantCount} active ${screen.activeParticipantCount === 1 ? 'friend' : 'friends'}.</p><div class="wrapped-mini-stats"><span><b>${screen.proofCount}</b><small>proofs</small></span><span><b>${screen.participantCount}</b><small>friends</small></span></div></div>`;
  if (screen.kind === 'participants') return `<div class="wrapped-slide"><small>THE CREW</small><h2>${screen.activeParticipantIds.length} ${screen.activeParticipantIds.length === 1 ? 'friend checked' : 'friends checked'} in.</h2><div class="wrapped-people">${screen.activeParticipantIds.map((id) => `<span><b>${esc(member(id)?.avatar || '?')}</b>${esc(member(id)?.name || 'Friend')}</span>`).join('')}</div></div>`;
  if (screen.kind === 'awards') return `<div class="wrapped-slide"><small>MONTHLY AWARDS</small><h2>Okay, receipts are in.</h2><div class="wrapped-awards">${screen.awards.map((award) => `<article><b>${award.type === 'most_supportive' ? '🤝' : award.type === 'baton_carrier' ? '↗' : award.type === 'longest_streak' ? '🔥' : '🏆'}</b><span><strong>${esc(award.title)}</strong><small>${award.memberIds.map((id) => esc(member(id)?.name || 'Friend')).join(' + ')}</small></span></article>`).join('')}</div></div>`;
  return `<div class="wrapped-slide close"><small>${wrapped.period.partial ? 'MONTH IN PROGRESS' : 'THAT’S A WRAP'}</small><h2>${wrapped.period.partial ? 'Still cooking.' : 'Run it back.'}</h2><p>Badges stay forever. Awards start fresh next month.</p></div>`;
}

export function wrappedSheet() {
  if (!ui.wrappedOpen) return '';
  const wrapped = monthlyWrapped();
  const index = Math.min(ui.wrappedIndex, wrapped.screens.length - 1);
  const screen = wrapped.screens[index];
  const winner = screen.kind === 'awards' && screen.awards.some((award) => award.memberIds.includes(me().id));
  return `<div class="wrapped-sheet" role="dialog" aria-modal="true" aria-label="Monthly Wrapped" data-wrapped><div class="wrapped-progress">${wrapped.screens.map((_, itemIndex) => `<i class="${itemIndex <= index ? 'active' : ''}"></i>`).join('')}</div><button class="wrapped-close" type="button" data-wrapped-close aria-label="Close Wrapped">×</button>${winner ? '<div class="wrapped-confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ''}${wrappedSlide(screen, wrapped)}<div class="wrapped-actions">${index > 0 ? '<button class="btn" type="button" data-wrapped-prev>Back</button>' : '<span></span>'}<button class="btn primary" type="button" ${index === wrapped.screens.length - 1 ? 'data-wrapped-close' : 'data-wrapped-next'}>${index === wrapped.screens.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
}

function bindWrappedSwipe(root) {
  const sheet = root.querySelector('[data-wrapped]');
  if (!sheet) return;
  let startX = null;
  sheet.addEventListener('touchstart', (event) => { startX = event.touches[0]?.clientX ?? null; }, { passive: true });
  sheet.addEventListener('touchend', (event) => {
    if (startX === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? startX) - startX;
    startX = null;
    if (Math.abs(delta) < 50) return;
    const total = monthlyWrapped().screens.length;
    ui.wrappedIndex = Math.max(0, Math.min(total - 1, ui.wrappedIndex + (delta < 0 ? 1 : -1)));
    render();
  }, { passive: true });
}

export function bindProfile(root) {
  root.querySelectorAll('[data-history-open]').forEach((element) => { element.onclick = () => { ui.historyOpen = true; render(); }; });
  root.querySelectorAll('[data-close-history]').forEach((element) => { element.onclick = () => { ui.historyOpen = false; render(); }; });
  root.querySelectorAll('[data-history-range]').forEach((element) => { element.onclick = () => { ui.historyRange = element.dataset.historyRange; render(); }; });
  root.querySelectorAll('[data-strip-missed]').forEach((element) => { element.onclick = () => {
    const date = element.dataset.stripMissed;
    const state = getState();
    const habit = myHabits(state).find((item) => !state.checkIns.some((checkIn) => checkIn.habitId === item.id && checkIn.userId === state.currentUserId && checkIn.date === date && !checkIn.invalid)
      && !(state.recoveries || []).some((recovery) => recovery.habitId === item.id && recovery.missedDate === date));
    if (habit) openRecovery(habit.id, date);
  }; });
  root.querySelectorAll('[data-badge-cabinet]').forEach((element) => { element.onclick = () => { ui.badgeCabinetOpen = true; render(); }; });
  root.querySelectorAll('[data-close-badges]').forEach((element) => { element.onclick = () => { ui.badgeCabinetOpen = false; render(); }; });
  root.querySelectorAll('[data-wrapped-open]').forEach((element) => { element.onclick = () => { ui.wrappedOpen = true; ui.wrappedIndex = 0; render(); }; });
  root.querySelectorAll('[data-wrapped-next]').forEach((element) => { element.onclick = () => { ui.wrappedIndex += 1; render(); }; });
  root.querySelectorAll('[data-wrapped-prev]').forEach((element) => { element.onclick = () => { ui.wrappedIndex = Math.max(0, ui.wrappedIndex - 1); render(); }; });
  root.querySelectorAll('[data-wrapped-close]').forEach((element) => { element.onclick = () => { ui.wrappedOpen = false; ui.wrappedIndex = 0; render(); }; });
  root.querySelectorAll('[data-edit-profile]').forEach((element) => { element.onclick = () => { ui.settingsView = 'profile'; ui.settingsSheetOpen = true; render(); }; });
  root.querySelectorAll('[data-share-profile]').forEach((element) => { element.onclick = handleShareInvite; });
  bindWrappedSwipe(root);
  bindProofThumbnails(root);
}
