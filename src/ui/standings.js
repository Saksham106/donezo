// Standings: weekly points race with a top-3 podium, a this/last week
// toggle, and the active challenge (only while one is running).
import { buildPrivacySafeExportPayload, buildWeeklySquadRecap } from '../social-domain.js';
import { leagueTimeLeft, rankMembersByWeeklyScore } from '../domain.js';
import { habitIsDue, isCheckedIn, shiftDate, weekBounds } from '../today-domain.js';
import { friendList, getState, leagueMembers, member, today, ui } from './state.js';
import { avatar, esc, formatWeekRange, icon, notify } from './util.js';
import { render } from './render.js';
import { activeChallenge, challengeProgress, hasPastChallengesOrStakes } from './social.js';

function selectedWeek() {
  const current = weekBounds(today());
  if (ui.standingsWeek !== 'last') return { ...current, asOf: today(), current: true };
  const previous = weekBounds(shiftDate(current.start, -1));
  return { ...previous, asOf: previous.end, current: false };
}

function ranked(week) {
  const state = getState();
  return rankMembersByWeeklyScore(leagueMembers(state), state.habits, state.checkIns, week.asOf);
}

function podium(top) {
  // Visual order is 2nd, 1st, 3rd.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return `<div class="dz-podium" data-count="${top.length}">${order.map((item) => `<button type="button" class="dz-podium-spot rank-${item.rank}" data-friend-profile="${item.id}">${avatar(item, item.rank === 1 ? 68 : 54)}<strong>${esc(item.id === getState().currentUserId ? 'You' : item.name)}</strong><small>${item.weeklyPoints} pts</small><span class="dz-podium-block">${item.rank}</span></button>`).join('')}</div>`;
}

function rankRow(item) {
  const mine = item.id === getState().currentUserId;
  const percent = Math.max(0, Math.min(100, Number(item.weeklyScore) || 0));
  return `<button type="button" class="dz-rank-row ${mine ? 'mine' : ''}" data-friend-profile="${item.id}"><span class="dz-rank">${item.rank}</span>${avatar(item, 36)}<span class="dz-rank-main"><span class="dz-rank-top"><strong>${esc(mine ? 'You' : item.name)}</strong><small>${item.weeklyCompleted} of ${item.weeklyPossible}</small></span><span class="dz-bar"><i style="width:${percent}%"></i></span></span><span class="dz-rank-points">${item.weeklyPoints}</span></button>`;
}

function challengeBlock() {
  const challenge = activeChallenge();
  if (!challenge) return `<button type="button" class="dz-link-row" data-challenge>${icon('target', 18)}<span>Start a weekly challenge</span>${icon('chevron', 16, 2.2)}</button>`;
  const progress = challengeProgress(challenge);
  return `<section class="dz-challenge"><div class="dz-challenge-head"><span class="dz-round-icon purple">${icon('target', 19)}</span><span class="dz-row-copy"><strong>${esc(challenge.title)}</strong><small>${progress.value} of ${progress.total} · ends ${esc(new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${challenge.endsOn}T12:00:00Z`)))}</small></span></div><div class="dz-bar thick" role="progressbar" aria-label="Challenge progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div></section>`;
}

function weeklyRecap(week) {
  const state = getState();
  const misses = [];
  for (let date = week.start; date <= week.asOf && date <= week.end; date = shiftDate(date, 1)) {
    for (const habit of state.habits) {
      if (!habit.active || !habitIsDue(habit, date)) continue;
      if (!isCheckedIn(state, habit.id, habit.ownerId, date)) misses.push({ habitId: habit.id, userId: habit.ownerId, date });
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
    weekStart: week.start,
    weekEnd: week.end,
    asOfDate: week.asOf,
    nextGoal: { title: 'Start next week together', cta: 'Create a challenge' },
  });
}

function recapCard(week) {
  const recap = weeklyRecap(week);
  const names = (award) => award.memberIds.map((id) => member(id)?.name || 'Friend').join(' + ') || '—';
  return `<section class="dz-recap" id="weekly-recap"><div class="dz-recap-head"><strong>Week in review</strong><b>${recap.summary.completionPercent}%</b></div><div class="dz-recap-grid"><span><small>Best streak</small>${esc(names(recap.awards.bestStreak))}</span><span><small>Biggest jump</small>${esc(names(recap.awards.biggestImprovement))}</span><span><small>Fastest comeback</small>${esc(names(recap.awards.fastestRecovery))}</span><span><small>Most supportive</small>${esc(names(recap.awards.mostSupportive))}</span></div><button class="dz-btn secondary full" type="button" data-share-recap>${icon('share', 17, 2)} Share recap</button></section>`;
}

export function standingsScreen() {
  const week = selectedWeek();
  const list = ranked(week);
  const timing = week.current ? leagueTimeLeft(week.end, today()) : 'Final';
  const rows = list.slice(3).map(rankRow).join('');
  const past = hasPastChallengesOrStakes() ? '<button type="button" class="dz-link-row subtle" data-past-open><span>Past challenges &amp; stakes</span>' + icon('chevron', 16, 2.2) + '</button>' : '';
  return `<header class="dz-header centered"><span></span><h1>Standings</h1><button type="button" class="dz-icon-btn info" data-challenge-info aria-label="How points work">i</button></header><div class="dz-segmented" role="tablist" aria-label="Week"><button type="button" role="tab" aria-selected="${week.current}" class="${week.current ? 'active' : ''}" data-standings-week="this">This week</button><button type="button" role="tab" aria-selected="${!week.current}" class="${week.current ? '' : 'active'}" data-standings-week="last">Last week</button></div><p class="dz-week-meta">${esc(formatWeekRange(week))} · <b>${esc(timing)}</b></p>${list.length ? podium(list.slice(0, 3)) : '<div class="dz-empty"><p>No one on the board yet.</p></div>'}${rows ? `<div class="dz-rank-list">${rows}</div>` : ''}${week.current ? challengeBlock() : recapCard(week)}${past}`;
}

async function createRecapImage(week) {
  const state = getState();
  const payload = buildPrivacySafeExportPayload(weeklyRecap(week));
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f2e8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e0573a';
  context.fillRect(64, 64, 120, 120);
  context.fillStyle = '#1d2433';
  context.font = '700 52px system-ui';
  context.fillText('donezo', 216, 142);
  context.font = '800 78px system-ui';
  context.fillText(`${state.circleName || 'Friends'} showed up`, 64, 330);
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

async function handleShareRecap() {
  const blob = await createRecapImage(selectedWeek());
  if (!blob) return;
  const file = new File([blob], 'donezo-weekly-recap.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: 'Donezo weekly recap', files: [file] });
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

export function bindStandings(root) {
  root.querySelectorAll('[data-standings-week]').forEach((element) => { element.onclick = () => { ui.standingsWeek = element.dataset.standingsWeek; render(); }; });
  root.querySelectorAll('[data-share-recap]').forEach((element) => { element.onclick = handleShareRecap; });
}
