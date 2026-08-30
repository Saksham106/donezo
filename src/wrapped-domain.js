const DAY_MS = 86_400_000;

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function dateAtNoon(value) {
  const key = dateKey(value);
  const date = new Date(`${key}T12:00:00Z`);
  if (!key || Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function addDays(value, amount) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must use YYYY-MM');
  const [year, rawMonth] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, rawMonth, 0, 12));
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) };
}

function memberId(value) { return value.id ?? value.userId ?? value.user_id; }
function itemDate(value) { return dateKey(value.date ?? value.checkDate ?? value.check_date ?? value.createdAt ?? value.created_at ?? value.handedAt ?? value.handed_at); }
function itemUser(value) { return value.userId ?? value.user_id ?? value.authorId ?? value.author_id; }
function itemCheckIn(value) { return value.checkInId ?? value.check_in_id; }
function valid(value) { return value && value.invalid !== true && value.valid !== false; }

function stableMemberSort(ids, members) {
  const names = new Map(members.map((member) => [memberId(member), member.name || member.displayName || member.username || memberId(member)]));
  return [...ids].sort((a, b) => String(names.get(a) || a).localeCompare(String(names.get(b) || b)) || String(a).localeCompare(String(b)));
}

function award(type, title, value, ids, members) {
  return { type, title, value, memberIds: stableMemberSort(ids, members) };
}

function longestStreak(dates) {
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of [...new Set(dates)].sort()) {
    current = previous && dateAtNoon(date).getTime() - dateAtNoon(previous).getTime() === DAY_MS ? current + 1 : 1;
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}

export function buildMonthlyWrapped({
  month, circleId = null, members = [], habits = [], checkIns = [], reactions = [], comments = [], batonHandoffs = [], nudges = [],
  asOfDate = null, timeZone = 'UTC', recapEnabled = true, recapOptOut = false,
} = {}) {
  const bounds = monthBounds(month);
  const asOf = dateKey(asOfDate) || bounds.end;
  const end = asOf < bounds.end ? asOf : bounds.end;
  const partial = end < bounds.end;
  const memberIds = new Set(members.map(memberId));
  const visibleMembers = members.filter((member) => memberId(member) && (!circleId || !member.circleId || member.circleId === circleId));
  const visibleMemberIds = new Set(visibleMembers.map(memberId));
  const scopedHabits = habits.filter((habit) => (!circleId || (habit.circleId ?? habit.circle_id) === circleId) && visibleMemberIds.has(habit.ownerId ?? habit.owner_id ?? habit.userId));
  const habitIds = new Set(scopedHabits.map((habit) => habit.id));
  const monthlyCheckIns = checkIns.map((item) => ({ ...item, date: dateKey(item.date ?? item.checkDate ?? item.check_date) }))
    .filter((item) => valid(item) && item.date && item.date >= bounds.start && item.date <= end && habitIds.has(item.habitId ?? item.habit_id) && visibleMemberIds.has(item.userId ?? item.user_id));
  const uniqueCheckIns = new Map();
  for (const checkIn of monthlyCheckIns) uniqueCheckIns.set(`${checkIn.userId ?? checkIn.user_id}:${checkIn.habitId ?? checkIn.habit_id}:${checkIn.date}`, checkIn);
  const completions = [...uniqueCheckIns.values()];
  const completionsByMember = new Map([...visibleMemberIds].map((id) => [id, []]));
  for (const completion of completions) completionsByMember.get(completion.userId ?? completion.user_id)?.push(completion);
  const eligibleAwards = visibleMembers.filter((member) => member.recapAwardsEnabled !== false && member.recap_awards_enabled !== false && member.awardOptOut !== true && member.award_opt_out !== true);
  const eligibleIds = new Set(eligibleAwards.map(memberId));
  const awardCandidates = (metric) => [...completionsByMember.entries()]
    .filter(([id]) => eligibleIds.has(id))
    .map(([id, values]) => ({ id, value: metric(values) }))
    .filter((entry) => entry.value > 0);
  const winners = (entries) => {
    if (!entries.length) return { value: 0, ids: [] };
    const value = Math.max(...entries.map((entry) => entry.value));
    return { value, ids: entries.filter((entry) => entry.value === value).map((entry) => entry.id) };
  };
  const completionWinners = winners(awardCandidates((values) => values.length));
  const streakWinners = winners(awardCandidates((values) => longestStreak(values.map((value) => value.date))));
  const supportCounts = new Map([...visibleMemberIds].map((id) => [id, 0]));
  for (const item of [...reactions, ...comments, ...nudges]) {
    const date = itemDate(item);
    const sender = itemUser(item) || item.fromUserId || item.from_user_id;
    const checkIn = itemCheckIn(item);
    const checkInVisible = !checkIn || completions.some((value) => value.id === checkIn);
    if (date && date >= bounds.start && date <= end && checkInVisible && supportCounts.has(sender)) supportCounts.set(sender, supportCounts.get(sender) + 1);
  }
  const supportWinners = winners([...supportCounts.entries()].filter(([id]) => eligibleIds.has(id)).map(([id, value]) => ({ id, value })));
  const scopedPasses = batonHandoffs.filter((item) => {
    const date = itemDate(item);
    const from = item.fromUserId ?? item.from_user_id;
    return date && date >= bounds.start && date <= end && visibleMemberIds.has(from) && (!circleId || (item.circleId ?? item.circle_id) === circleId);
  });
  const batonWinners = winners([...new Set(scopedPasses.map((item) => item.fromUserId ?? item.from_user_id))]
    .filter((id) => eligibleIds.has(id)).map((id) => ({ id, value: scopedPasses.filter((item) => (item.fromUserId ?? item.from_user_id) === id).length })));
  const awards = recapEnabled && !recapOptOut ? [
    completionWinners.value && award('most_completed', 'Most completed', completionWinners.value, completionWinners.ids, members),
    streakWinners.value && award('longest_streak', 'Longest streak', streakWinners.value, streakWinners.ids, members),
    supportWinners.value && award('most_supportive', 'Most supportive', supportWinners.value, supportWinners.ids, members),
    batonWinners.value && award('baton_carrier', 'Baton carrier', batonWinners.value, batonWinners.ids, members),
  ].filter(Boolean).slice(0, 5) : [];
  const total = completions.length;
  const activeParticipantIds = [...completionsByMember.entries()].filter(([, values]) => values.length).map(([id]) => id);
  const memberStats = visibleMembers.map((member) => {
    const values = completionsByMember.get(memberId(member)) || [];
    return { id: memberId(member), name: member.name || member.displayName || member.username || memberId(member), completions: values.length, proofCount: values.filter((value) => value.proofPath || value.proof_path).length, bestStreak: longestStreak(values.map((value) => value.date)) };
  });
  const aggregate = { completionCount: total, participantCount: visibleMembers.length, activeParticipantCount: activeParticipantIds.length, proofCount: memberStats.reduce((sum, stat) => sum + stat.proofCount, 0) };
  return {
    version: 1,
    period: { month, start: bounds.start, end, complete: !partial, partial, timeZone },
    privacy: { recapEnabled: Boolean(recapEnabled), optedOut: Boolean(recapOptOut), namedAwards: awards.length > 0 },
    summary: aggregate,
    memberStats,
    awards,
    screens: [
      { id: 'cover', title: `${month} Wrapped`, kind: 'cover' },
      { id: 'numbers', title: 'The numbers', kind: 'summary', ...aggregate },
      { id: 'squad', title: 'Squad activity', kind: 'participants', activeParticipantIds: stableMemberSort(activeParticipantIds, members) },
      ...(awards.length ? [{ id: 'awards', title: 'Squad awards', kind: 'awards', awards }] : []),
      { id: 'close', title: partial ? 'Month in progress' : 'Keep the streak alive', kind: 'close', partial },
    ].slice(0, 5),
  };
}

export const buildWrapped = buildMonthlyWrapped;
export const monthlyWrapped = buildMonthlyWrapped;
