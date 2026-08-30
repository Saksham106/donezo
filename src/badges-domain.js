import { getScheduleOccurrence } from './schedule.js';

const DAY_MS = 86_400_000;

export const BADGE_CATALOG = Object.freeze([
  { id: 'streak_7', name: 'One Week Locked', description: 'Reach a 7-day completion streak.', category: 'streak', threshold: 7 },
  { id: 'streak_30', name: 'Month Locked', description: 'Reach a 30-day completion streak.', category: 'streak', threshold: 30 },
  { id: 'streak_100', name: 'Triple Digits', description: 'Reach a 100-day completion streak.', category: 'streak', threshold: 100 },
  { id: 'streak_365', name: 'Year Locked', description: 'Reach a 365-day completion streak.', category: 'streak', threshold: 365 },
  { id: 'completions_25', name: 'First 25', description: 'Complete 25 valid habit occurrences.', category: 'completion', threshold: 25 },
  { id: 'completions_100', name: 'Century Club', description: 'Complete 100 valid habit occurrences.', category: 'completion', threshold: 100 },
  { id: 'completions_500', name: 'Five Hundred', description: 'Complete 500 valid habit occurrences.', category: 'completion', threshold: 500 },
  { id: 'completions_1000', name: 'The Thousand', description: 'Complete 1,000 valid habit occurrences.', category: 'completion', threshold: 1000 },
  { id: 'perfect_week', name: 'Perfect Week', description: 'Complete every scheduled occurrence in a full week.', category: 'consistency' },
  { id: 'perfect_month', name: 'Perfect Month', description: 'Complete every scheduled occurrence in a full calendar month.', category: 'consistency' },
  { id: 'triple_threat', name: 'Triple Threat', description: 'Complete three different habits on one local day.', category: 'variety', threshold: 3 },
  { id: 'weekend_warrior', name: 'Weekend Warrior', description: 'Complete a habit on both Saturday and Sunday in one weekend.', category: 'consistency' },
  { id: 'proof_10', name: 'Receipts', description: 'Attach proof to 10 valid completions.', category: 'proof', threshold: 10 },
  { id: 'proof_50', name: 'Proof Machine', description: 'Attach proof to 50 valid completions.', category: 'proof', threshold: 50 },
  { id: 'proof_100', name: 'Ironclad', description: 'Attach proof to 100 valid completions.', category: 'proof', threshold: 100 },
  { id: 'baton_1', name: 'Pass It On', description: 'Pass the baton once.', category: 'baton', threshold: 1 },
  { id: 'baton_10', name: 'Relay Runner', description: 'Pass the baton 10 times.', category: 'baton', threshold: 10 },
  { id: 'baton_50', name: 'Squad Engine', description: 'Pass the baton 50 times.', category: 'baton', threshold: 50 },
  { id: 'longevity_30', name: 'Still Here', description: 'Keep your Donezo account for 30 days.', category: 'longevity', threshold: 30 },
  { id: 'longevity_365', name: 'Year One', description: 'Keep your Donezo account for one year.', category: 'longevity', threshold: 365 },
  { id: 'day_one', name: 'Day One', description: 'Complete your first valid occurrence on the day you joined.', category: 'longevity' },
]);

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

function daysBetween(start, end) {
  if (start > end) return [];
  const days = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

function mondayOf(value) {
  const date = dateAtNoon(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must use YYYY-MM');
  const [year, rawMonth] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(year, rawMonth, 0, 12));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

function checkInFields(checkIn) {
  return {
    id: checkIn.id,
    habitId: checkIn.habitId ?? checkIn.habit_id,
    userId: checkIn.userId ?? checkIn.user_id,
    date: dateKey(checkIn.date ?? checkIn.checkDate ?? checkIn.check_date),
    proofPath: checkIn.proofPath ?? checkIn.proof_path,
    invalid: checkIn.invalid === true || checkIn.valid === false,
  };
}

function validFacts({ userId, habits = [], checkIns = [], batonHandoffs = [], asOfDate, joinedDate, timeZone = 'UTC' }) {
  const asOf = dateKey(asOfDate) || dateKey(new Date());
  const ownedHabitIds = new Set(habits
    .filter((habit) => (habit.ownerId ?? habit.owner_id ?? habit.userId) === userId)
    .map((habit) => habit.id));
  const unique = new Map();
  for (const raw of checkIns) {
    const item = checkInFields(raw);
    if (item.userId !== userId || !item.habitId || !ownedHabitIds.has(item.habitId) || item.invalid || !item.date || item.date > asOf) continue;
    unique.set(`${item.habitId}:${item.date}`, item);
  }
  const completions = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const dates = [...new Set(completions.map((item) => item.date))].sort();
  const byDate = new Map();
  for (const item of completions) {
    if (!byDate.has(item.date)) byDate.set(item.date, new Set());
    byDate.get(item.date).add(item.habitId);
  }
  const passes = batonHandoffs.filter((handoff) => (
    (handoff.fromUserId ?? handoff.from_user_id) === userId
    && (!handoff.handedAt && !handoff.handed_at || dateKey(handoff.handedAt ?? handoff.handed_at) <= asOf)
  ));
  const firstCompletion = dates[0] || null;
  const join = dateKey(joinedDate);
  return { asOf, completions, dates, byDate, firstCompletion, proofCount: completions.filter((item) => item.proofPath).length, passCount: passes.length, join, timeZone };
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

function occurrence(habit, date) {
  try {
    return getScheduleOccurrence({
      frequency: habit.scheduleFrequency || habit.frequency || 'daily',
      weekdays: habit.scheduleWeekdays || habit.schedule_weekdays || [],
      targetQuantity: habit.targetQuantity ?? habit.target_quantity ?? 1,
      targetUnit: habit.targetUnit || habit.target_unit || 'count',
      dueTime: habit.targetTime || habit.target_time || null,
      graceMinutes: habit.graceMinutes ?? habit.grace_minutes ?? 0,
      timezone: habit.scheduleTimezone || habit.ownerTimeZone || habit.timeZone || 'UTC',
      startDate: habit.createdDate || habit.created_date || date,
      pauseWindows: habit.pauseWindows || habit.pause_windows || [],
      versions: habit.scheduleVersions || habit.versions || [],
    }, date);
  } catch {
    return { scheduled: (habit.frequency || 'daily') === 'daily' };
  }
}

function periodPerfect(facts, habits, start, end) {
  const ownedHabits = habits.filter((habit) => (habit.ownerId ?? habit.owner_id ?? habit.userId) === facts.userId);
  const completed = new Set(facts.completions.map((item) => `${item.habitId}:${item.date}`));
  let possible = 0;
  let done = 0;
  for (const date of daysBetween(start, end)) {
    for (const habit of ownedHabits) {
      const habitStart = dateKey(habit.createdDate ?? habit.created_date ?? habit.createdAt ?? date) || date;
      if (date < habitStart || habit.active === false && date > (dateKey(habit.archivedDate ?? habit.archived_date) || date)) continue;
      if (!occurrence(habit, date).scheduled) continue;
      possible += 1;
      if (completed.has(`${habit.id}:${date}`)) done += 1;
    }
  }
  return possible > 0 && done === possible;
}

function hasPerfectWeek(facts, habits) {
  for (const date of facts.dates) {
    const start = mondayOf(date);
    const end = addDays(start, 6);
    if (end <= facts.asOf && periodPerfect(facts, habits, start, end)) return true;
  }
  return false;
}

function hasPerfectMonth(facts, habits) {
  const seen = new Set(facts.dates.map((date) => date.slice(0, 7)));
  for (const month of seen) {
    const bounds = monthBounds(month);
    if (bounds.end <= facts.asOf && periodPerfect(facts, habits, bounds.start, bounds.end)) return true;
  }
  return false;
}

function earnedAtFor(id, facts, habits) {
  if (id.startsWith('completions_')) return facts.completions[Number(id.split('_')[1]) - 1]?.date || facts.asOf;
  if (id.startsWith('proof_')) return facts.completions.filter((item) => item.proofPath)[Number(id.split('_')[1]) - 1]?.date || facts.asOf;
  if (id.startsWith('baton_')) return facts.asOf;
  if (id.startsWith('streak_')) return facts.asOf;
  if (id === 'day_one') return facts.join;
  return facts.asOf;
}

export function computeEarnedBadges(input = {}) {
  const userId = input.userId ?? input.memberId;
  if (!userId) throw new Error('userId is required');
  const facts = validFacts({ ...input, userId });
  const habits = input.habits || [];
  const streak = longestStreak(facts.dates);
  const longestJoin = facts.join ? Math.floor((dateAtNoon(facts.asOf) - dateAtNoon(facts.join)) / DAY_MS) : 0;
  const weekend = facts.dates.some((date) => {
    const day = dateAtNoon(date).getUTCDay();
    if (day !== 6 && day !== 0) return false;
    const saturday = day === 6 ? date : addDays(date, -1);
    return facts.dates.includes(saturday) && facts.dates.includes(addDays(saturday, 1));
  });
  const tripleThreat = [...facts.byDate.values()].some((habitIds) => habitIds.size >= 3);
  const perfectWeek = hasPerfectWeek({ ...facts, userId }, habits);
  const perfectMonth = hasPerfectMonth({ ...facts, userId }, habits);
  const earned = BADGE_CATALOG.filter((badge) => {
    if (badge.category === 'streak') return streak >= badge.threshold;
    if (badge.category === 'completion') return facts.completions.length >= badge.threshold;
    if (badge.category === 'proof') return facts.proofCount >= badge.threshold;
    if (badge.category === 'baton') return facts.passCount >= badge.threshold;
    if (badge.id === 'perfect_week') return perfectWeek;
    if (badge.id === 'perfect_month') return perfectMonth;
    if (badge.id === 'triple_threat') return tripleThreat;
    if (badge.id === 'weekend_warrior') return weekend;
    if (badge.id === 'day_one') return Boolean(facts.join && facts.firstCompletion === facts.join);
    if (badge.category === 'longevity') return longestJoin >= badge.threshold;
    return false;
  });
  return earned.map((badge) => ({ ...badge, earnedAt: earnedAtFor(badge.id, facts, habits), userId }));
}

export const deriveBadges = computeEarnedBadges;
export const computeBadges = computeEarnedBadges;
export function getBadgeCatalog() { return BADGE_CATALOG.map((badge) => ({ ...badge })); }
