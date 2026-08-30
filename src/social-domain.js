const DAY_MS = 86_400_000;
const DEFAULT_SUPPORT_EMOJIS = new Set(['👏', '🔥', '💪', '❤️', '❤', '🙌', '👍', '🎉', '✨']);

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  return text.slice(0, 10);
}

function dateAtNoon(value) {
  const key = dateKey(value);
  const date = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function addDays(value, amount) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const first = dateAtNoon(start);
  const last = dateAtNoon(end);
  if (last < first) return [];
  const days = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

function mondayOf(value) {
  const date = dateAtNoon(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function roundPercent(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function normalizeMetric(challenge = {}) {
  const metric = challenge.metric || challenge.type || 'completion_percentage';
  const aliases = {
    completion: 'completion_percentage',
    completion_percent: 'completion_percentage',
    completion_percentage: 'completion_percentage',
    completionPercentage: 'completion_percentage',
    total: 'total_completions',
    completions: 'total_completions',
    total_completions: 'total_completions',
    totalCompletions: 'total_completions',
    'no-consecutive-miss': 'no_consecutive_miss',
    'no-consecutive-misses': 'no_consecutive_miss',
    no_consecutive_miss: 'no_consecutive_miss',
    no_consecutive_misses: 'no_consecutive_miss',
    noConsecutiveMiss: 'no_consecutive_miss',
  };
  if (!aliases[metric]) throw new Error(`Unsupported challenge metric: ${metric}`);
  return aliases[metric];
}

function resolvePeriod(source = {}, challenge = {}) {
  const asOfDate = source.asOfDate || challenge.asOfDate;
  const start = source.weekStart || challenge.weekStart || (asOfDate && mondayOf(asOfDate));
  if (!start) throw new Error('A weekStart or asOfDate is required');
  const requestedEnd = source.weekEnd || challenge.weekEnd || addDays(start, 6);
  const effectiveEnd = asOfDate && dateKey(asOfDate) < dateKey(requestedEnd) ? dateKey(asOfDate) : dateKey(requestedEnd);
  if (dateKey(effectiveEnd) < dateKey(start)) throw new Error('weekEnd must not precede weekStart');
  return {
    start: dateKey(start),
    end: effectiveEnd,
    requestedEnd: dateKey(requestedEnd),
    days: daysBetween(start, effectiveEnd),
  };
}

function ownerIdOf(habit) {
  return habit.ownerId ?? habit.userId ?? habit.owner_id;
}

function localDateInTimeZone(value, timeZone = 'UTC') {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return dateKey(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${result.year}-${result.month}-${result.day}`;
}

function habitCreatedDate(habit, fallback) {
  return habit.createdDate
    || habit.created_date
    || (habit.createdAt && localDateInTimeZone(habit.createdAt, habit.ownerTimeZone || habit.timeZone || 'UTC'))
    || fallback;
}

function habitArchivedDate(habit) {
  return habit.archivedDate
    || habit.archived_date
    || (habit.active === false && habit.updatedAt && localDateInTimeZone(habit.updatedAt, habit.ownerTimeZone || habit.timeZone || 'UTC'));
}

function habitIsEligible(habit, memberIds, date, challenge = {}) {
  const ownerId = ownerIdOf(habit);
  if (!memberIds.has(ownerId)) return false;
  if ((habit.frequency || 'daily') !== 'daily') return false;
  const created = habitCreatedDate(habit, date);
  const archived = habitArchivedDate(habit);
  if (date < created || (archived && date > archived)) return false;
  if (habit.active === false && !archived) return false;
  if (challenge.squadId) {
    const squadIds = habit.squadIds || habit.squad_ids || [habit.circleId || habit.circle_id];
    if (!squadIds.includes(challenge.squadId)) return false;
  }
  return true;
}

function checkInDate(checkIn) {
  return checkIn.date || checkIn.checkDate || checkIn.check_date;
}

function validCheckIn(checkIn) {
  return checkIn && checkIn.invalid !== true && checkIn.valid !== false;
}

function memberList(members = [], participantIds = []) {
  if (members.length) return members.map((member) => ({ ...member, id: member.id ?? member.userId ?? member.user_id }));
  return participantIds.map((id) => ({ id, name: id }));
}

function commitmentData({ members = [], habits = [], checkIns = [], challenge = {}, period }) {
  const participantIds = challenge.participantIds || challenge.participant_ids || members.map((member) => member.id);
  const participantSet = new Set(participantIds);
  const resolvedMembers = memberList(members, participantIds);
  const completedKeys = new Set();
  for (const checkIn of checkIns) {
    const date = checkInDate(checkIn);
    if (!validCheckIn(checkIn) || !date || date < period.start || date > period.end) continue;
    const key = `${checkIn.habitId ?? checkIn.habit_id}:${checkIn.userId ?? checkIn.user_id}:${date}`;
    completedKeys.add(key);
  }
  const slots = [];
  for (const date of period.days) {
    for (const habit of habits) {
      const ownerId = ownerIdOf(habit);
      if (!habitIsEligible(habit, participantSet, date, challenge)) continue;
      const key = `${habit.id}:${ownerId}:${date}`;
      slots.push({ memberId: ownerId, habitId: habit.id, date, key, completed: completedKeys.has(key) });
    }
  }
  return { participantIds, participantSet, members: resolvedMembers, slots };
}

function participantStats(data) {
  return data.members.map((member) => {
    const slots = data.slots.filter((slot) => slot.memberId === member.id);
    const completed = slots.filter((slot) => slot.completed).length;
    return {
      ...member,
      completed,
      total: slots.length,
      percent: roundPercent(completed, slots.length),
    };
  });
}

function awardWinnerIds(stats, valueOf) {
  const active = stats.filter((stat) => stat.total > 0);
  if (!active.length) return [];
  const best = Math.max(...active.map(valueOf));
  return active.filter((stat) => valueOf(stat) === best)
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || String(a.id).localeCompare(String(b.id)))
    .map((stat) => stat.id);
}

function longestStreak(dates) {
  const unique = [...new Set(dates.map(dateKey))].sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of unique) {
    current = previous && dateAtNoon(date).getTime() - dateAtNoon(previous).getTime() === DAY_MS ? current + 1 : 1;
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}

function consecutiveMisses(data) {
  const violations = [];
  const byMember = new Map(data.participantIds.map((id) => [id, []]));
  for (const habit of data.slots.reduce((map, slot) => {
    const key = `${slot.memberId}:${slot.habitId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(slot);
    return map;
  }, new Map()).values()) {
    const sorted = [...habit].sort((a, b) => a.date.localeCompare(b.date));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (!previous.completed && !current.completed && addDays(previous.date, 1) === current.date) {
        const violation = { memberId: current.memberId, habitId: current.habitId, dates: [previous.date, current.date] };
        violations.push(violation);
        byMember.get(current.memberId).push(violation);
      }
    }
  }
  return { violations, byMember };
}

export function weeklyChallengeProgress(challenge = {}, input = {}) {
  const metric = normalizeMetric(challenge);
  const period = resolvePeriod(input, challenge);
  const data = commitmentData({ ...input, challenge, period });
  const stats = participantStats(data);
  const missData = metric === 'no_consecutive_miss' ? consecutiveMisses(data) : { violations: [], byMember: new Map() };
  const totalSlots = data.slots.length;
  const completedSlots = data.slots.filter((slot) => slot.completed).length;
  const target = Number(challenge.target ?? (metric === 'completion_percentage' ? 100 : metric === 'no_consecutive_miss' ? data.participantIds.length : 1));
  let completed;
  let total;
  let percent;
  let achieved;
  if (metric === 'completion_percentage') {
    completed = completedSlots;
    total = totalSlots;
    percent = roundPercent(completed, total);
    achieved = total > 0 && percent >= target;
  } else if (metric === 'total_completions') {
    completed = completedSlots;
    total = target;
    percent = Math.min(100, roundPercent(completed, total));
    achieved = completed >= target;
  } else {
    completed = data.participantIds.filter((id) => (missData.byMember.get(id) || []).length === 0 && data.slots.some((slot) => slot.memberId === id)).length;
    total = data.participantIds.filter((id) => data.slots.some((slot) => slot.memberId === id)).length;
    percent = roundPercent(completed, total);
    achieved = total > 0 && missData.violations.length === 0;
  }
  const winnerIds = metric === 'no_consecutive_miss'
    ? stats.filter((stat) => stat.total > 0 && !(missData.byMember.get(stat.id) || []).length).map((stat) => stat.id)
    : awardWinnerIds(stats, (stat) => metric === 'completion_percentage' ? stat.percent : stat.completed);
  const progress = {
    completed,
    total,
    target,
    ratio: ratio(completed, total),
    percent,
    achieved,
  };
  const status = period.end < period.requestedEnd ? 'in_progress' : achieved ? 'completed' : 'failed';
  return {
    challenge: { ...challenge, metric, type: metric },
    period: { start: period.start, end: period.end },
    status,
    progress,
    completed,
    total,
    target,
    ratio: progress.ratio,
    percent,
    achieved,
    participants: stats.map((stat) => ({
      ...stat,
      consecutiveMisses: (missData.byMember.get(stat.id) || []).length,
    })),
    violations: missData.violations,
    winnerIds,
  };
}

function recoveryInput(args, checkIns, recoveryEvents, date, asOfDate) {
  if (args && args.habit) return args;
  return { habit: args, checkIns: checkIns || [], recoveryEvents: recoveryEvents || [], date, asOfDate };
}

export function missedHabitRecoveryState(args, checkIns, recoveryEvents, date, asOfDate) {
  const input = recoveryInput(args, checkIns, recoveryEvents, date, asOfDate);
  const habit = input.habit || {};
  const targetDate = dateKey(input.date);
  const currentDate = dateKey(input.asOfDate || input.date);
  const habitId = habit.id ?? habit.habitId;
  const userId = ownerIdOf(habit);
  const completed = (input.checkIns || []).some((checkIn) => validCheckIn(checkIn)
    && (checkIn.habitId ?? checkIn.habit_id) === habitId
    && (checkIn.userId ?? checkIn.user_id) === userId
    && dateKey(checkInDate(checkIn)) === targetDate);
  const recovery = (input.recoveryEvents || []).find((event) => event.habitId === habitId && event.userId === userId && event.missedDate === targetDate) || null;
  let status = 'upcoming';
  if (targetDate <= currentDate) status = completed ? 'completed' : 'missed';
  if (recovery) status = 'recovered';
  return {
    habitId,
    userId,
    date: targetDate,
    status,
    originalStatus: status === 'upcoming' || status === 'completed' ? status : 'missed',
    canRecover: status === 'missed',
    recoveryAction: status === 'missed' ? 'recover_today' : null,
    recovery,
  };
}

export function createRecoveryEvent({ habitId, userId, missedDate, recoveredDate, action = 'recover_today', reason = null, supportRequested = false, visibility = 'private' }) {
  const missed = dateKey(missedDate);
  const recovered = dateKey(recoveredDate);
  if (!habitId || !userId || !missed || !recovered) throw new Error('Recovery requires habit, user, and dates');
  if (recovered < missed) throw new Error('recoveredDate must be on or after missedDate');
  if (!['recover_today', 'adjust_habit', 'pause_habit', 'ask_support'].includes(action)) throw new Error(`Unsupported recovery action: ${action}`);
  if (!['private', 'squad'].includes(visibility)) throw new Error(`Unsupported recovery visibility: ${visibility}`);
  return {
    habitId, userId, missedDate: missed, recoveredDate: recovered, action,
    reason: reason == null ? null : String(reason), supportRequested: Boolean(supportRequested), visibility,
  };
}

export function applyRecovery(state = {}, recovery) {
  if (!recovery) throw new Error('A recovery event is required');
  return {
    ...state,
    misses: (state.misses || []).map((miss) => ({ ...miss })),
    recoveries: [...(state.recoveries || []).map((event) => ({ ...event })), { ...recovery }],
  };
}

function normalizeMiss(miss) {
  if (typeof miss === 'string') return { habitId: null, userId: null, date: dateKey(miss) };
  return {
    ...miss,
    habitId: miss.habitId ?? miss.habit_id ?? null,
    userId: miss.userId ?? miss.user_id ?? null,
    date: dateKey(miss.date ?? miss.missedDate ?? miss.missed_date),
  };
}

function recoveryForMiss(miss, recoveries) {
  return recoveries.find((event) => event.habitId === miss.habitId
    && event.userId === miss.userId && dateKey(event.missedDate) === miss.date) || null;
}

export function calculateBounceBackMetrics({ misses = [], recoveries = [], checkIns = [], asOfDate = null } = {}) {
  const normalizedMisses = misses.map(normalizeMiss).filter((miss) => miss.date);
  const validCheckIns = checkIns.filter(validCheckIn).map((checkIn) => ({
    ...checkIn,
    habitId: checkIn.habitId ?? checkIn.habit_id,
    userId: checkIn.userId ?? checkIn.user_id,
    date: dateKey(checkInDate(checkIn)),
  }));
  const bounces = normalizedMisses.map((miss) => {
    const recovery = recoveryForMiss(miss, recoveries);
    const completion = validCheckIns
      .filter((checkIn) => (miss.habitId == null || checkIn.habitId === miss.habitId)
        && (miss.userId == null || checkIn.userId === miss.userId)
        && checkIn.date > miss.date
        && (!asOfDate || checkIn.date <= dateKey(asOfDate)))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const recoveredDate = recovery?.recoveredDate || completion?.date || null;
    const bounceBackDays = recoveredDate ? Math.round((dateAtNoon(recoveredDate) - dateAtNoon(miss.date)) / DAY_MS) : null;
    return { ...miss, recoveredDate, bounceBackDays, recovered: Boolean(recoveredDate) };
  });
  const recovered = bounces.filter((bounce) => bounce.recovered);
  const speeds = recovered.map((bounce) => bounce.bounceBackDays);
  const relevantCheckIns = validCheckIns.filter((checkIn) => !asOfDate || checkIn.date <= dateKey(asOfDate));
  const recoveryDates = new Set(recovered.map((bounce) => `${bounce.userId}:${bounce.habitId}:${bounce.recoveredDate}`));
  let longestRecoveryStreak = 0;
  let currentRecoveryStreak = 0;
  for (const bounce of recovered) {
    if (!bounce.recoveredDate) continue;
    const dates = new Set(relevantCheckIns
      .filter((checkIn) => checkIn.habitId === bounce.habitId && checkIn.userId === bounce.userId && checkIn.date >= bounce.recoveredDate)
      .map((checkIn) => checkIn.date));
    let streak = 0;
    let cursor = bounce.recoveredDate;
    while (dates.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, 1);
    }
    longestRecoveryStreak = Math.max(longestRecoveryStreak, streak);
    if (asOfDate && dates.has(dateKey(asOfDate))) currentRecoveryStreak = Math.max(currentRecoveryStreak, streak);
  }
  if (!asOfDate && recovered.length) currentRecoveryStreak = longestRecoveryStreak;
  return {
    missedCount: bounces.length,
    recoveredCount: recovered.length,
    unrecoveredCount: bounces.length - recovered.length,
    recoveryRate: roundPercent(recovered.length, bounces.length),
    averageBounceBackDays: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null,
    fastestBounceBackDays: speeds.length ? Math.min(...speeds) : null,
    currentRecoveryStreak,
    longestRecoveryStreak,
    bounces,
    recoveryDates: [...recoveryDates],
  };
}

function weekStats({ members, habits, checkIns, weekStart, weekEnd, asOfDate }) {
  const period = resolvePeriod({ weekStart, weekEnd, asOfDate }, {});
  const data = commitmentData({ members, habits, checkIns, challenge: {}, period });
  const stats = participantStats(data);
  const completed = data.slots.filter((slot) => slot.completed).length;
  return { period, data, stats, completed, total: data.slots.length, percent: roundPercent(completed, data.slots.length) };
}

function memberNameMap(members) {
  return new Map(members.map((member) => [member.id, member.name || member.displayName || member.username || member.id]));
}

function sortedIds(ids, names) {
  return [...ids].sort((a, b) => String(names.get(a) || a).localeCompare(String(names.get(b) || b)) || String(a).localeCompare(String(b)));
}

function award(value, memberIds, names) {
  return { value, memberIds: sortedIds(memberIds, names) };
}

function recoveryAward(members, misses, recoveries, checkIns, period) {
  const candidates = members.map((member) => ({
    id: member.id,
    metrics: calculateBounceBackMetrics({
      misses: misses.filter((miss) => {
        const date = dateKey(miss.date ?? miss.missedDate ?? miss.missed_date);
        return (miss.userId ?? miss.user_id) === member.id && date >= period.start && date <= period.end;
      }),
      recoveries: recoveries.filter((recovery) => recovery.userId === member.id),
      checkIns,
      asOfDate: period.end,
    }),
  })).filter(({ metrics }) => metrics.fastestBounceBackDays != null);
  if (!candidates.length) return { value: 0, memberIds: [] };
  const fastest = Math.min(...candidates.map(({ metrics }) => metrics.fastestBounceBackDays));
  return { value: fastest, memberIds: candidates.filter(({ metrics }) => metrics.fastestBounceBackDays === fastest).map(({ id }) => id) };
}

function activityInPeriod(item, period) {
  const timestamp = item.createdAt || item.created_at || item.date;
  if (!timestamp) return true;
  const date = dateKey(timestamp);
  return date >= period.start && date <= period.end;
}

export function buildWeeklySquadRecap({
  members = [], habits = [], checkIns = [], misses = [], recoveries = [], nudges = [], reactions = [],
  weekStart, weekEnd, previousWeekStart, previousWeekEnd, asOfDate,
  nextGoal = null, supportEmojis = DEFAULT_SUPPORT_EMOJIS,
} = {}) {
  const current = weekStats({ members, habits, checkIns, weekStart, weekEnd, asOfDate });
  const previousStart = previousWeekStart || addDays(current.period.start, -7);
  const previousEnd = previousWeekEnd || addDays(previousStart, current.period.days.length - 1);
  const previous = weekStats({ members, habits, checkIns, weekStart: previousStart, weekEnd: previousEnd });
  const names = memberNameMap(members);
  const previousById = new Map(previous.stats.map((stat) => [stat.id, stat]));
  const memberStats = current.stats.map((stat) => {
    const prior = previousById.get(stat.id) || { percent: 0, completed: 0, total: 0 };
    const validDates = checkIns.filter((checkIn) => validCheckIn(checkIn)
      && (checkIn.userId ?? checkIn.user_id) === stat.id
      && checkInDate(checkIn) >= current.period.start && checkInDate(checkIn) <= current.period.end).map(checkInDate);
    const improvement = stat.percent - prior.percent;
    return {
      id: stat.id, name: names.get(stat.id) || stat.id,
      completed: stat.completed, total: stat.total, completionPercent: stat.percent,
      previousCompletionPercent: prior.percent, improvement, bestStreak: longestStreak(validDates),
      active: stat.completed > 0,
    };
  });
  const bestStreakValue = Math.max(0, ...memberStats.map((stat) => stat.bestStreak));
  const improvements = memberStats.filter((stat) => stat.total > 0 || stat.previousCompletionPercent > 0);
  const biggestImprovementValue = improvements.length ? Math.max(...improvements.map((stat) => stat.improvement)) : 0;
  const supportive = new Map(members.map((member) => [member.id, 0]));
  const emojiSet = supportEmojis instanceof Set ? supportEmojis : new Set(supportEmojis);
  for (const nudge of nudges.filter((item) => activityInPeriod(item, current.period))) {
    const sender = nudge.fromUserId ?? nudge.from_user_id;
    if (supportive.has(sender)) supportive.set(sender, supportive.get(sender) + 1);
  }
  for (const reaction of reactions.filter((item) => activityInPeriod(item, current.period))) {
    const sender = reaction.userId ?? reaction.user_id;
    if (supportive.has(sender) && emojiSet.has(reaction.emoji)) supportive.set(sender, supportive.get(sender) + 1);
  }
  const maxSupport = members.length ? Math.max(0, ...supportive.values()) : 0;
  const optOutMemberIds = new Set(members.filter((member) => member.awardOptOut || member.award_opt_out).map((member) => member.id));
  const filterAward = (value, ids) => award(value, ids.filter((id) => !optOutMemberIds.has(id)), names);
  return {
    period: { start: current.period.start, end: current.period.end },
    previousPeriod: { start: previous.period.start, end: previous.period.end },
    summary: {
      completionPercent: current.percent,
      previousCompletionPercent: previous.percent,
      changePoints: current.percent - previous.percent,
      participantCount: members.length,
      activeParticipantCount: memberStats.filter((stat) => stat.active).length,
    },
    memberStats,
    awards: {
      bestStreak: filterAward(bestStreakValue, bestStreakValue ? memberStats.filter((stat) => stat.bestStreak === bestStreakValue).map((stat) => stat.id) : []),
      biggestImprovement: filterAward(biggestImprovementValue, biggestImprovementValue || improvements.length ? improvements.filter((stat) => stat.improvement === biggestImprovementValue).map((stat) => stat.id) : []),
      fastestRecovery: filterAward(...(() => { const result = recoveryAward(members, misses, recoveries, checkIns, current.period); return [result.value, result.memberIds]; })()),
      mostSupportive: filterAward(maxSupport, maxSupport ? [...supportive.entries()].filter(([, count]) => count === maxSupport).map(([id]) => id) : []),
    },
    nextGoal,
    optOutMemberIds: [...optOutMemberIds],
  };
}

function exportAward(awardValue, optOuts) {
  return {
    value: awardValue.value,
    memberIds: awardValue.memberIds.filter((id) => !optOuts.has(id)),
  };
}

function safeNextGoal(goal) {
  if (goal == null || typeof goal === 'string' || typeof goal === 'number' || typeof goal === 'boolean') return goal ?? null;
  if (typeof goal !== 'object') return null;
  const allowedKeys = ['title', 'label', 'metric', 'target', 'cta'];
  return Object.fromEntries(allowedKeys.filter((key) => goal[key] != null).map((key) => [key, goal[key]]));
}

export function buildPrivacySafeExportPayload(recap, {
  optOutMemberIds = recap.optOutMemberIds || [],
  confirmed = false,
  includePrivateTexts = false,
  includeProofImages = false,
  privateTexts = [],
  proofImages = [],
} = {}) {
  const optOuts = new Set([...(recap.optOutMemberIds || []), ...optOutMemberIds]);
  const payload = {
    version: 1,
    period: { ...recap.period },
    previousPeriod: { ...recap.previousPeriod },
    summary: { ...recap.summary },
    participants: (recap.memberStats || []).map((stat) => ({
      name: stat.name, completionPercent: stat.completionPercent, bestStreak: stat.bestStreak,
    })),
    awards: Object.fromEntries(Object.entries(recap.awards || {}).map(([key, value]) => [key, exportAward(value, optOuts)])),
    nextGoal: safeNextGoal(recap.nextGoal),
  };
  if (confirmed && includePrivateTexts) payload.privateTexts = [...privateTexts];
  if (confirmed && includeProofImages) payload.proofImages = [...proofImages];
  return payload;
}
