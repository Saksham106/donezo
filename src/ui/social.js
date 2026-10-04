// Updates (bell), nudges, bounce-back recovery, weekly challenges, the
// points explainer with Baton, and legacy stakes.
import { rankMembersByWeeklyScore } from '../domain.js';
import { weeklyChallengeProgress } from '../social-domain.js';
import { resolveStake } from '../stakes.js';
import { enableNotifications, getNotificationCapability, sendTestNotification, shouldOfferNotificationPrompt, syncPushSubscription } from '../notifications.js';
import { updatesList, weekBounds } from '../today-domain.js';
import { activityList, friendList, getState, member, today, ui } from './state.js';
import { avatar, esc, formatWhen, icon, notify, readableError } from './util.js';
import { render } from './render.js';
import { runMutation, runOptimisticMutation, scheduleStateCacheWrite } from './sync.js';
import { openFriendProfile, openInviteSheet } from './people.js';
import { openCheckIn, handleHabit } from './checkin.js';
import { openHabitEditor } from './habits.js';

export const NOTIFICATION_PROMPT_DISMISSED_KEY = 'donezo.notificationPromptDismissed';

// --- Updates ---------------------------------------------------------------------

export async function openUpdatesCenter() {
  ui.updatesOpen = true;
  ui.repo.applyUpdatesSeen?.(new Date().toISOString());
  render();
  try {
    await ui.repo.markUpdatesSeen?.();
    scheduleStateCacheWrite();
  } catch (error) {
    notify(readableError(error), 3600);
    void ui.refreshCoordinator?.request('updates-seen-failed');
  }
  render();
}

function notificationOptIn() {
  const capability = getNotificationCapability(window);
  let dismissed = false;
  try { dismissed = localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === '1'; } catch { dismissed = false; }
  if (!shouldOfferNotificationPrompt(capability, dismissed)) return '';
  return `<aside class="dz-optin" role="status"><div><strong>Get the useful nudges.</strong><small>Habit reminders and friend updates, even when Donezo is closed.</small></div><div class="dz-btn-row"><button class="dz-btn secondary small" type="button" data-dismiss-notification-prompt>Not now</button><button class="dz-btn primary small" type="button" data-enable-notifications>Enable</button></div></aside>`;
}

export function updatesSheet() {
  if (!ui.updatesOpen) return '';
  const state = getState();
  const updates = updatesList(state, activityList(state));
  const marks = { reaction: '👏', comment: '💬', due_soon: '⏱', streak_risk: '🔥', challenge_progress: '🏆', friend_activity: '👀' };
  const rows = updates.map((item) => {
    if (item.kind === 'notification') {
      return `<article class="dz-update"><span class="dz-update-mark" aria-hidden="true">${marks[item.category] || '🔔'}</span><span class="dz-row-copy"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></span></article>`;
    }
    const actor = member(item.userId);
    if (item.kind === 'nudge') {
      return `<article class="dz-update ${item.readAt ? 'read' : ''}">${avatar(actor, 36)}<span class="dz-row-copy"><strong>⚡ ${esc(actor?.name || 'Friend')} nudged you</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></span>${item.readAt ? '<span class="dz-fine">Seen</span>' : `<button class="dz-btn secondary small" type="button" data-read-nudge="${item.sourceId}">Got it</button>`}</article>`;
    }
    const activity = item.activity;
    const detail = activity?.habitTitle ? `${activity.emoji || '✓'} ${activity.habitTitle}` : item.message;
    return `<button class="dz-update" type="button" data-friend-profile="${item.userId}">${avatar(actor, 36)}<span class="dz-row-copy"><strong>${esc(actor?.name || 'Friend')}</strong><p>${esc(detail)}</p><small>${esc(formatWhen(item.when))}</small></span></button>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall updates-sheet" role="dialog" aria-modal="true" aria-label="Updates" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Updates</h2></div><div class="dz-head-actions"><button class="dz-icon-btn small ${ui.manualRefreshLoading ? 'loading' : ''}" type="button" data-manual-refresh aria-label="Refresh" ${ui.manualRefreshLoading ? 'disabled' : ''}>${icon('refresh', 18)}</button><button class="icon-btn" type="button" data-close-updates aria-label="Close">×</button></div></div>${notificationOptIn()}${rows ? `<div class="dz-update-list">${rows}</div>` : '<div class="dz-empty"><h2>All caught up</h2><p>Nudges, reactions and replies show up here.</p></div>'}</section></div>`;
}

async function handleReadNudge(nudgeId) {
  const nudge = (getState()?.nudges || []).find((item) => item.id === nudgeId);
  if (!nudge || nudge.readAt) return;
  await runOptimisticMutation({
    key: `nudge-read:${nudgeId}`,
    apply: () => ui.repo.applyNudgeRead(nudgeId, new Date().toISOString()),
    rollback: () => ui.repo.applyNudgeRead(nudgeId, null),
    persist: () => ui.repo.markNudgeRead(nudgeId),
    errorMessage: 'Could not mark nudge read',
  });
}

export async function handleNotifications() {
  const capability = getNotificationCapability(window);
  if (capability.permission === 'granted') {
    let synced = false;
    try { synced = await syncPushSubscription(ui.repo); } catch { synced = false; }
    const tested = await sendTestNotification();
    notify(synced && tested ? 'Push is locked in 🔔' : tested ? 'Local test works. Remote push is still cooking.' : 'Could not send notification');
    return;
  }
  const result = await enableNotifications(ui.repo);
  notify(result.permission === 'granted'
    ? (result.pushRegistered ? 'Push is locked in 🔔' : 'Permission granted. Remote push is still cooking.')
    : `Notifications: ${result.permission}`);
  render();
}

// --- Nudges ----------------------------------------------------------------------

export function nudgeComposerSheet() {
  if (!ui.nudgeComposerUserId) return '';
  const friend = member(ui.nudgeComposerUserId);
  const quick = ['Lock in bro 😭', "Don't sell 💀", "Clock's ticking lil bro", 'You got this 🤝'];
  return `<div class="sheet-backdrop nudge-composer-layer" data-close-sheet><section class="sheet compact-sheet dz-sheet" role="dialog" aria-modal="true" aria-label="Nudge friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Nudge ${esc(friend?.name || 'friend')}</h2></div><button class="icon-btn" type="button" data-close-nudge aria-label="Close">×</button></div><div class="dz-chip-wrap">${quick.map((message) => `<button type="button" class="dz-pill neutral" data-nudge-copy="${esc(message)}">${esc(message)}</button>`).join('')}</div><form id="nudge-form" class="form sheet-form"><label>Message<textarea name="message" maxlength="140" rows="3" required>Lock in bro 😭</textarea></label><p class="dz-fine">Only ${esc(friend?.name || 'your friend')} sees it. 140 characters max.</p><button class="dz-btn primary full" ${ui.busy ? 'disabled' : ''}>Send nudge</button></form></section></div>`;
}

async function handleNudgeSubmit(event) {
  event.preventDefault();
  const toUserId = ui.nudgeComposerUserId;
  const friend = member(toUserId);
  const message = String(new FormData(event.currentTarget).get('message'));
  const result = await runMutation(() => ui.repo.sendNudge(toUserId, message, 'private'));
  if (!result) return;
  ui.nudgeComposerUserId = null;
  const label = `Nudged ${friend?.name || 'friend'} privately ⚡`;
  notify(result.pushSent ? label : `${label} Push missed the bus 🚌`, 3200);
  render();
}

// --- Bounce back ------------------------------------------------------------------

export function openRecovery(habitId, missedDate) {
  ui.recoveryHabitId = habitId;
  ui.recoveryMissedDate = missedDate || null;
  render();
}

export function recoverySheet() {
  if (!ui.recoveryHabitId) return '';
  const habit = getState().habits.find((item) => item.id === ui.recoveryHabitId);
  if (!habit) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet recovery-sheet" role="dialog" aria-modal="true" aria-label="Bounce back" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">BOUNCE BACK</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-close-recovery aria-label="Close">×</button></div><p class="sheet-copy">The miss still counts. Pick the next useful move.</p><form id="recovery-form" class="form sheet-form"><input type="hidden" name="missedDate" value="${esc(ui.recoveryMissedDate || '')}"><label>Next move<select name="action"><option value="recover_today">Recover today</option><option value="adjust_habit">Adjust this habit</option><option value="pause_habit">Pause for now</option><option value="ask_support">Ask friends for support</option></select></label><label>Optional note<textarea name="reflection" maxlength="280" rows="3" placeholder="What got in the way?"></textarea></label><label class="inline-check"><input type="checkbox" name="share"> Let my friends encourage me</label><button class="dz-btn primary full">Save comeback</button></form></section></div>`;
}

async function handleRecoverySubmit(event) {
  event.preventDefault();
  const habitId = ui.recoveryHabitId;
  const form = new FormData(event.currentTarget);
  const action = String(form.get('action'));
  const result = await runMutation(() => ui.repo.recoverHabit(habitId, String(form.get('missedDate')), {
    action,
    reflection: String(form.get('reflection') || ''),
    visibility: form.get('share') ? 'squad' : 'private',
  }), 'Comeback saved. Next rep.');
  if (!result) return;
  ui.recoveryHabitId = null;
  ui.recoveryMissedDate = null;
  if (action === 'adjust_habit' || action === 'pause_habit') openHabitEditor(habitId);
  else if (action === 'recover_today') await handleHabit(habitId);
  else render();
}

// --- Challenges, points, baton -------------------------------------------------------

export function challengeProgress(challenge) {
  const state = getState();
  const result = weeklyChallengeProgress({ ...challenge, metric: challenge.kind, weekStart: challenge.startsOn, weekEnd: challenge.endsOn }, {
    members: friendList(state),
    habits: state.habits,
    checkIns: state.checkIns,
    asOfDate: today() < challenge.endsOn ? today() : challenge.endsOn,
  });
  return { value: result.completed, total: result.total, percent: result.percent, status: result.status };
}

export function activeChallenge() {
  return (getState().challenges || []).find((item) => item.status === 'active' && item.endsOn >= today()) || null;
}

export function challengeSheet() {
  if (!ui.challengeSheetOpen) return '';
  const period = weekBounds(today());
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet challenge-sheet" role="dialog" aria-modal="true" aria-label="Start a weekly challenge" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Start a challenge</h2></div><button class="icon-btn" type="button" data-close-challenge aria-label="Close">×</button></div><p class="sheet-copy">One shared target this week. Everyone’s real check-ins move the same bar.</p><form id="challenge-form" class="form sheet-form"><label>Challenge<select name="kind"><option value="completion_percent">Group completion percent</option><option value="total_completions">Total check-ins</option><option value="no_consecutive_miss">No back-to-back misses</option></select></label><label>Name<input name="title" maxlength="80" value="Hit 80% together" required></label><label>Target<input name="target" type="number" min="1" max="10000" value="80" required></label><input type="hidden" name="startsOn" value="${period.start}"><input type="hidden" name="endsOn" value="${period.end}"><button class="dz-btn primary full">Start challenge</button></form></section></div>`;
}

async function handleChallengeSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await runMutation(() => ui.repo.createChallenge({
    kind: String(form.get('kind')),
    title: String(form.get('title')),
    target: Number(form.get('target')),
    startsOn: String(form.get('startsOn')),
    endsOn: String(form.get('endsOn')),
  }), 'Challenge started. It’s live.');
  if (result) { ui.challengeSheetOpen = false; render(); }
}

function batonCard() {
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const holder = baton ? member(baton.holderUserId) : null;
  const mine = baton?.holderUserId === state.currentUserId;
  const eligibleCheckIn = state.checkIns.find((item) => item.userId === state.currentUserId && !item.invalid);
  const hasFriend = friendList(state).some((person) => person.id !== state.currentUserId);
  const card = (title, detail, action) => `<section class="dz-list-row baton-card"><span class="dz-round-icon">↗</span><span class="dz-row-copy"><strong>${title}</strong><small>${detail}</small></span>${action}</section>`;
  if (!baton) {
    if (!hasFriend) return card('Baton · Invite a friend', 'Hand off the next move.', '<button class="dz-btn secondary small" type="button" data-invite-open>Invite</button>');
    if (!eligibleCheckIn) return card('Baton · Check in to start', 'Then pick who goes next.', '<button class="dz-btn secondary small" type="button" data-checkin-action>Go</button>');
    return card('Baton · Pick who’s next', 'Keep the momentum moving.', '<button class="dz-btn secondary small" type="button" data-baton-open>Start</button>');
  }
  return card(mine ? 'Baton · Your turn' : `The baton is with ${esc(holder?.name || 'a friend')}`, mine ? 'Check in, then pass it on.' : 'One turn at a time.', mine && eligibleCheckIn && hasFriend ? '<button class="dz-btn secondary small" type="button" data-baton-open>Pass</button>' : '');
}

export function challengeInfoSheet() {
  if (!ui.challengeInfoOpen) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall challenge-info-sheet" role="dialog" aria-modal="true" aria-label="How points work" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>How points work</h2></div><button class="icon-btn" type="button" data-close-challenge-info aria-label="Close">×</button></div><section class="dz-sheet-section dz-rules"><p><strong>Completed commitments</strong><br>The first 3 each day earn 10 points. The 4th earns 5 and the 5th earns 2. Anything beyond that doesn’t pad the table.</p><p><strong>Clean-day bonus</strong><br>Finish everything due that day for 5 extra points.</p><p><strong>Anti-spam lock</strong><br>New habits unlock volume points after 2 separate days. They still count toward your completion rate immediately.</p><p class="dz-fine">Standings run Monday to Sunday and reset every Monday.</p></section><section class="dz-sheet-section"><h3>Pass the momentum</h3>${batonCard()}</section></section></div>`;
}

export function batonSheet() {
  if (!ui.batonSheetOpen) return '';
  const state = getState();
  const baton = state.baton?.active ? state.baton : null;
  const source = state.checkIns.filter((item) => item.userId === state.currentUserId && !item.invalid).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  const recipients = friendList(state).filter((person) => person.id !== state.currentUserId);
  if (!source || !recipients.length) return '';
  const mode = baton ? 'pass' : 'start';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet baton-sheet" role="dialog" aria-modal="true" aria-label="Pass the baton" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Who goes next?</h2></div><button class="icon-btn" type="button" data-close-baton aria-label="Close">×</button></div><p class="sheet-copy">Your check-in starts the handoff. They get one turn, then pass it forward.</p><form id="baton-form" class="form sheet-form" data-mode="${mode}"><input type="hidden" name="sourceCheckInId" value="${esc(source.id)}"><label>Pass to<select name="recipientUserId" required>${recipients.map((person) => `<option value="${person.id}">${esc(person.name)}</option>`).join('')}</select></label><button class="dz-btn primary full" ${ui.busy ? 'disabled' : ''}>${mode === 'pass' ? 'Pass baton' : 'Start baton'}</button></form></section></div>`;
}

async function handleBatonSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recipientUserId = String(form.get('recipientUserId') || '');
  const sourceCheckInId = String(form.get('sourceCheckInId') || '');
  const mode = event.currentTarget.dataset.mode;
  const friend = member(recipientUserId);
  const result = await runMutation(
    () => mode === 'pass' ? ui.repo.passBaton(recipientUserId, sourceCheckInId) : ui.repo.startBaton(recipientUserId, sourceCheckInId),
    `Baton passed to ${friend?.name || 'your friend'} ↗`,
  );
  if (result) { ui.batonSheetOpen = false; render(); }
}

// --- Past challenges and legacy stakes ----------------------------------------------------

function legacyStakeCard() {
  const state = getState();
  const stake = (state.stakes || []).find((item) => ['pending', 'active'].includes(item.status));
  if (!stake) return '';
  const myConsent = (state.stakeConsents || []).find((item) => item.stakeId === stake.id && item.userId === state.currentUserId);
  const canResolve = stake.status === 'active' && stake.createdBy === state.currentUserId && today() > stake.endsOn;
  const respond = stake.status === 'pending' && myConsent?.status !== 'accepted'
    ? `<div class="dz-btn-row"><button class="dz-btn primary small" type="button" data-stake-response="accepted" data-stake-id="${stake.id}">I’m in</button><button class="dz-btn secondary small" type="button" data-stake-response="declined" data-stake-id="${stake.id}">Pass</button></div>`
    : '';
  return `<section class="dz-sheet-section"><h3>${stake.status === 'active' ? 'Current stake' : 'Stake waiting on you'}</h3><article class="dz-list-row column"><strong>${esc(stake.reward || stake.consequence)}</strong><small>New stakes are retired. This one stays until it ends.</small>${respond}${canResolve ? `<button class="dz-btn secondary small" type="button" data-resolve-stake="${stake.id}">Resolve</button>` : ''}</article></section>`;
}

function stakeHistoryRows() {
  return (getState().stakes || []).filter((item) => ['resolved', 'declined'].includes(item.status)).slice(0, 5).map((stake) => {
    if (stake.status === 'declined') return `<article class="dz-list-row column"><strong>${esc(stake.reward || stake.consequence)}</strong><small>Passed. No pressure, no penalty.</small></article>`;
    const resultIds = stake.rule === 'loser' ? (stake.resolution?.losers || []) : (stake.resolution?.winners || []);
    const names = resultIds.map((id) => member(id)?.name).filter(Boolean);
    const result = stake.rule === 'all_succeed'
      ? (stake.resolution?.allSucceeded ? 'Everybody did it 🤝' : 'Not this time.')
      : names.length ? `${names.map(esc).join(', ')} ${names.length === 1 ? 'takes it' : 'take it'} ${stake.rule === 'loser' ? '😅' : '🏆'}` : 'Finished with no result';
    return `<article class="dz-list-row column"><strong>${esc(stake.reward || stake.consequence)}</strong><small>${result}</small></article>`;
  }).join('');
}

export function hasPastChallengesOrStakes() {
  const state = getState();
  return (state.challenges || []).some((item) => item.status !== 'active' || item.endsOn < today()) || (state.stakes || []).length > 0;
}

export function pastChallengesSheet() {
  if (!ui.pastChallengesOpen) return '';
  const history = (getState().challenges || []).filter((item) => item.status !== 'active' || item.endsOn < today());
  const challengeRows = history.map((challenge) => {
    const progress = challengeProgress(challenge);
    const result = challenge.status === 'cancelled' ? 'cancelled' : progress.percent >= 100 ? 'completed' : 'finished';
    return `<article class="dz-list-row"><span class="dz-row-copy"><strong>${esc(challenge.title)}</strong><small>${esc(challenge.startsOn)} – ${esc(challenge.endsOn)}</small></span><span class="dz-fine">${progress.percent}% · ${result}</span></article>`;
  }).join('');
  const stakes = stakeHistoryRows();
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall" role="dialog" aria-modal="true" aria-label="Past challenges" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Past challenges</h2></div><button class="icon-btn" type="button" data-close-past aria-label="Close">×</button></div><section class="dz-sheet-section">${challengeRows || '<p class="dz-fine">No finished challenges yet.</p>'}</section>${legacyStakeCard()}${stakes ? `<section class="dz-sheet-section"><h3>Past stakes</h3>${stakes}</section>` : ''}</section></div>`;
}

async function handleStakeResolve(stakeId) {
  const state = getState();
  const stake = state.stakes.find((item) => item.id === stakeId);
  if (!stake) return;
  const standings = rankMembersByWeeklyScore(friendList(state), state.habits, state.checkIns, stake.endsOn).map((item) => ({ id: item.id, percent: item.weeklyScore }));
  await runMutation(() => ui.repo.resolveStake(stakeId, resolveStake(stake.rule, standings)), 'Settled. Receipts are in.');
}

// --- Binding ----------------------------------------------------------------------------

export function bindSocial(root) {
  root.querySelectorAll('[data-updates-open]').forEach((element) => { element.onclick = () => { void openUpdatesCenter(); }; });
  root.querySelectorAll('[data-close-updates]').forEach((element) => { element.onclick = () => { ui.updatesOpen = false; if (window.location.search.includes('nudges=')) history.replaceState({}, '', window.location.pathname); render(); }; });
  root.querySelectorAll('[data-read-nudge]').forEach((element) => { element.onclick = () => handleReadNudge(element.dataset.readNudge); });
  root.querySelectorAll('[data-enable-notifications]').forEach((element) => { element.onclick = handleNotifications; });
  root.querySelectorAll('[data-dismiss-notification-prompt]').forEach((element) => { element.onclick = () => {
    try { localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, '1'); } catch { /* Shown again next time. */ }
    render();
  }; });
  root.querySelectorAll('[data-nudge]').forEach((element) => { element.onclick = () => { ui.nudgeComposerUserId = element.dataset.nudge; render(); }; });
  root.querySelectorAll('[data-nudge-copy]').forEach((element) => { element.onclick = () => { const textarea = root.querySelector('#nudge-form textarea'); if (textarea) textarea.value = element.dataset.nudgeCopy; }; });
  root.querySelectorAll('[data-close-nudge]').forEach((element) => { element.onclick = () => { ui.nudgeComposerUserId = null; render(); }; });
  root.querySelector('#nudge-form')?.addEventListener('submit', handleNudgeSubmit);
  root.querySelectorAll('[data-close-recovery]').forEach((element) => { element.onclick = () => { ui.recoveryHabitId = null; render(); }; });
  root.querySelector('#recovery-form')?.addEventListener('submit', handleRecoverySubmit);
  root.querySelectorAll('[data-challenge]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = false; ui.challengeSheetOpen = true; render(); }; });
  root.querySelectorAll('[data-close-challenge]').forEach((element) => { element.onclick = () => { ui.challengeSheetOpen = false; render(); }; });
  root.querySelector('#challenge-form')?.addEventListener('submit', handleChallengeSubmit);
  root.querySelectorAll('[data-challenge-info]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = true; render(); }; });
  root.querySelectorAll('[data-close-challenge-info]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = false; render(); }; });
  root.querySelectorAll('[data-baton-open]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = false; ui.batonSheetOpen = true; render(); }; });
  root.querySelectorAll('[data-close-baton]').forEach((element) => { element.onclick = () => { ui.batonSheetOpen = false; render(); }; });
  root.querySelector('#baton-form')?.addEventListener('submit', handleBatonSubmit);
  root.querySelectorAll('[data-past-open]').forEach((element) => { element.onclick = () => { ui.pastChallengesOpen = true; render(); }; });
  root.querySelectorAll('[data-close-past]').forEach((element) => { element.onclick = () => { ui.pastChallengesOpen = false; render(); }; });
  root.querySelectorAll('[data-stake-response]').forEach((element) => { element.onclick = () => runMutation(() => ui.repo.respondToStake(element.dataset.stakeId, element.dataset.stakeResponse), element.dataset.stakeResponse === 'accepted' ? 'You’re in.' : 'Passed. Nothing activates.'); });
  root.querySelectorAll('[data-resolve-stake]').forEach((element) => { element.onclick = () => handleStakeResolve(element.dataset.resolveStake); });
  root.querySelectorAll('.dz-update[data-friend-profile]').forEach((element) => { element.onclick = () => openFriendProfile(element.dataset.friendProfile); });
  root.querySelectorAll('.baton-card [data-invite-open]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = false; openInviteSheet(); }; });
  root.querySelectorAll('.baton-card [data-checkin-action]').forEach((element) => { element.onclick = () => { ui.challengeInfoOpen = false; openCheckIn(); }; });
}
