export function dailyProgress(completed, total) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const ratio = safeTotal === 0 ? 0 : safeCompleted / safeTotal;
  return { completed: safeCompleted, total: safeTotal, ratio, percent: Math.round(ratio * 100) };
}

export function calculateStreak(dateStrings, todayString) {
  const completed = new Set(dateStrings);
  const cursor = new Date(`${todayString}T12:00:00Z`);
  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!completed.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function calculateBestStreak(dateStrings) {
  const dates = [...new Set(dateStrings)].sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of dates) {
    const day = new Date(`${date}T12:00:00Z`);
    const consecutive = previous && day.getTime() - previous.getTime() === 86_400_000;
    current = consecutive ? current + 1 : 1;
    best = Math.max(best, current);
    previous = day;
  }
  return best;
}

export function rankMembers(members) {
  return [...members].sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name)).map((member, index) => ({ ...member, rank: index + 1 }));
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function localDateInTimeZone(value, timeZone = 'UTC') {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return dateKey(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${result.year}-${result.month}-${result.day}`;
}

export function proofRejectionThreshold(circleMemberCount) {
  const otherMembers = Math.max(0, Number(circleMemberCount || 0) - 1);
  return otherMembers === 0 ? Infinity : Math.floor(otherMembers / 2) + 1;
}

export function rejectedCheckInIds(checkIns, reactions, circleMemberCount) {
  const threshold = proofRejectionThreshold(circleMemberCount);
  if (!Number.isFinite(threshold)) return new Set();
  const checkInById = new Map(checkIns.map((checkIn) => [checkIn.id, checkIn]));
  const votersByCheckIn = new Map();
  for (const reaction of reactions || []) {
    if (reaction.emoji !== '👎') continue;
    const checkIn = checkInById.get(reaction.checkInId);
    if (!checkIn || reaction.userId === checkIn.userId) continue;
    if (!votersByCheckIn.has(reaction.checkInId)) votersByCheckIn.set(reaction.checkInId, new Set());
    votersByCheckIn.get(reaction.checkInId).add(reaction.userId);
  }
  return new Set([...votersByCheckIn.entries()].filter(([, voters]) => voters.size >= threshold).map(([checkInId]) => checkInId));
}

function mondayOf(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return dateKey(date);
}

function inclusiveDays(startString, endString) {
  const start = new Date(`${startString}T12:00:00Z`);
  const end = new Date(`${endString}T12:00:00Z`);
  if (start > end) return [];
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(dateKey(cursor));
  }
  return days;
}

export function weeklyCompletionScore(memberId, habits, checkIns, todayString) {
  const weekStart = mondayOf(todayString);
  const eligibleHabits = habits.filter((habit) => habit.ownerId === memberId && habit.active !== false && (habit.frequency || 'daily') === 'daily');
  const completed = new Set(checkIns
    .filter((checkIn) => checkIn.userId === memberId && checkIn.invalid !== true)
    .map((checkIn) => `${checkIn.habitId}:${checkIn.date}`));
  let possible = 0;
  let completedCount = 0;

  for (const habit of eligibleHabits) {
    const createdDate = habit.createdDate
      || (habit.createdAt ? localDateInTimeZone(habit.createdAt, habit.ownerTimeZone || 'UTC') : weekStart);
    const start = createdDate > weekStart ? createdDate : weekStart;
    for (const day of inclusiveDays(start, todayString)) {
      possible += 1;
      if (completed.has(`${habit.id}:${day}`)) completedCount += 1;
    }
  }

  return {
    completed: completedCount,
    possible,
    percent: possible === 0 ? 0 : Math.round((completedCount / possible) * 100),
  };
}

export function rankMembersByWeeklyScore(members, habits, checkIns, todayString) {
  return members
    .map((member) => {
      const score = weeklyCompletionScore(member.id, habits, checkIns, todayString);
      return {
        ...member,
        weeklyScore: score.percent,
        weeklyCompleted: score.completed,
        weeklyPossible: score.possible,
      };
    })
    .sort((a, b) => b.weeklyScore - a.weeklyScore || (b.currentStreak || 0) - (a.currentStreak || 0) || a.name.localeCompare(b.name))
    .map((member, index) => ({ ...member, rank: index + 1 }));
}
