// Pure "what is due / done today" logic, ported from app.js so screens and
// tests share one implementation. Every function takes state and dates
// explicitly; nothing here touches the DOM or the repository.
import { getScheduleOccurrence } from './schedule.js';
import { dailyProgress, weeklyCompletionScore } from './domain.js';

export function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday–Sunday week containing dateString. */
export function weekBounds(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  const start = date.toISOString().slice(0, 10);
  return { start, end: shiftDate(start, 6) };
}

export function habitSchedule(habit) {
  return {
    frequency: habit.scheduleFrequency || habit.frequency || 'daily',
    weekdays: habit.scheduleWeekdays || [],
    weeklyTargetDays: habit.weeklyTargetDays ?? 1,
    targetQuantity: habit.targetQuantity ?? 1,
    targetUnit: habit.targetUnit || 'count',
    dueTime: habit.targetTime || null,
    graceMinutes: habit.graceMinutes || 0,
    timezone: habit.scheduleTimezone || habit.ownerTimeZone || 'UTC',
    startDate: habit.createdDate || null,
    pauseWindows: habit.pauseWindows || [],
    versions: habit.scheduleVersions || [],
  };
}

export function habitIsDue(habit, date) {
  try {
    return getScheduleOccurrence(habitSchedule(habit), date).scheduled;
  } catch {
    return true;
  }
}

export function habitPausedOn(habit, date) {
  return (habit?.pauseWindows || []).some((pause) => pause.startDate <= date && date <= pause.endDate);
}

export function scheduleVersionForDate(habit, date) {
  return [...(habit.scheduleVersions || [])]
    .filter((version) => version.effectiveFrom <= date && (!version.effectiveUntil || date < version.effectiveUntil))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || Number(a.version || 0) - Number(b.version || 0))
    .at(-1) || null;
}

export function currentFlexibleHabit(habit, date) {
  const version = scheduleVersionForDate(habit, date);
  const frequency = version?.frequency || habit.scheduleFrequency || habit.frequency || 'daily';
  if (frequency !== 'times_per_week') return null;
  const effectiveFrom = version?.effectiveFrom || habit.createdDate || date;
  const weeklyTargetDays = Number(version?.weeklyTargetDays ?? habit.weeklyTargetDays ?? 1);
  const targetQuantity = Number(version?.targetQuantity ?? habit.targetQuantity ?? 1);
  const targetUnit = version?.targetUnit || habit.targetUnit || 'count';
  const targetTime = version?.dueTime ?? habit.targetTime ?? '';
  const graceMinutes = Number(version?.graceMinutes ?? habit.graceMinutes ?? 0);
  const scheduleTimezone = version?.timezone || habit.scheduleTimezone || habit.ownerTimeZone || 'UTC';
  const scopedVersion = {
    version: Number(version?.version || 1),
    effectiveFrom,
    effectiveUntil: version?.effectiveUntil || null,
    frequency: 'times_per_week',
    weekdays: [],
    weeklyTargetDays,
    targetQuantity,
    targetUnit,
    dueTime: targetTime || null,
    graceMinutes,
    timezone: scheduleTimezone,
  };
  return {
    ...habit,
    frequency: 'times_per_week',
    scheduleFrequency: 'times_per_week',
    scheduleWeekdays: [],
    weeklyTargetDays,
    targetQuantity,
    targetUnit,
    targetTime,
    graceMinutes,
    scheduleTimezone,
    createdDate: effectiveFrom,
    scheduleVersions: [scopedVersion],
  };
}

export function isCheckedIn(state, habitId, userId, date) {
  return state.checkIns.some((item) => item.habitId === habitId && item.userId === userId && item.date === date && !item.invalid);
}

export function flexibleWeekProgress(habit, date, state) {
  const scopedHabit = currentFlexibleHabit(habit, date);
  if (!scopedHabit) return null;
  const weekly = weeklyCompletionScore(habit.ownerId, [scopedHabit], state.checkIns, date);
  let paused = false;
  try { paused = getScheduleOccurrence(habitSchedule(scopedHabit), date).paused; } catch { paused = false; }
  return {
    ...weekly,
    target: Number(scopedHabit.weeklyTargetDays ?? 1),
    paused,
    completedToday: isCheckedIn(state, habit.id, habit.ownerId, date),
    complete: weekly.possible > 0 && weekly.completed >= weekly.possible,
    startsNextMonday: weekly.possible === 0 && !paused,
  };
}

export function myHabits(state) {
  return state.habits.filter((habit) => habit.ownerId === state.currentUserId && habit.active);
}

export function dueHabitsFor(memberId, date, state) {
  return state.habits.filter((habit) => habit.ownerId === memberId && habit.active && habitIsDue(habit, date));
}

export function flexibleHabitsFor(memberId, date, state, includeComplete = true) {
  return state.habits.filter((habit) => {
    if (habit.ownerId !== memberId || !habit.active) return false;
    const weekly = flexibleWeekProgress(habit, date, state);
    return Boolean(weekly && !weekly.paused && (includeComplete || !weekly.complete));
  });
}

export function visibleHabitsFor(memberId, date, state) {
  return [...dueHabitsFor(memberId, date, state), ...flexibleHabitsFor(memberId, date, state, true)];
}

/** Habits the member can still check in for on date (the Check In button's work list). */
export function actionableHabitsFor(memberId, date, state) {
  const fixed = dueHabitsFor(memberId, date, state).filter((habit) => !isCheckedIn(state, habit.id, memberId, date));
  const flexible = flexibleHabitsFor(memberId, date, state, false).filter((habit) => !flexibleWeekProgress(habit, date, state)?.completedToday);
  return [...fixed, ...flexible];
}

/** Habits already completed on date (shown as "Done today · …"). */
export function completedHabitsFor(memberId, date, state) {
  return visibleHabitsFor(memberId, date, state).filter((habit) => isCheckedIn(state, habit.id, memberId, date));
}

export function progressFor(memberId, date, state) {
  const habits = dueHabitsFor(memberId, date, state);
  const completed = habits.filter((habit) => isCheckedIn(state, habit.id, memberId, date)).length;
  return dailyProgress(completed, habits.length);
}

export function sortHabitsForDay(habits, state, userId, date) {
  return [...habits].sort((a, b) => Number(isCheckedIn(state, a.id, userId, date)) - Number(isCheckedIn(state, b.id, userId, date))
    || (a.targetTime || '99:99').localeCompare(b.targetTime || '99:99')
    || a.title.localeCompare(b.title));
}

/** Yesterday's scheduled habits that were neither completed nor recovered. */
export function missedHabits(state, today) {
  const yesterday = shiftDate(today, -1);
  return myHabits(state).filter((habit) => {
    const existed = !habit.createdDate || habit.createdDate <= yesterday;
    const recovered = (state.recoveries || []).some((item) => item.habitId === habit.id && item.missedDate === yesterday);
    return existed && habitIsDue(habit, yesterday) && !isCheckedIn(state, habit.id, state.currentUserId, yesterday) && !recovered;
  }).map((habit) => ({ ...habit, missedDate: yesterday }));
}

/**
 * Status for one day of the Profile week strip.
 * completed: every due habit done. recovered: misses all have a recovery.
 * missed: at least one unrecovered miss. today / upcoming / none otherwise.
 */
export function dayStatus(state, userId, date, today) {
  if (date > today) return 'upcoming';
  const habits = state.habits.filter((habit) => habit.ownerId === userId && habit.active
    && (!habit.createdDate || habit.createdDate <= date) && habitIsDue(habit, date));
  const pending = habits.filter((habit) => !isCheckedIn(state, habit.id, userId, date));
  if (date === today) return habits.length && !pending.length ? 'completed' : 'today';
  if (!habits.length) return 'none';
  if (!pending.length) return 'completed';
  const recovered = pending.every((habit) => (state.recoveries || []).some((item) => item.habitId === habit.id && item.missedDate === date));
  return recovered ? 'recovered' : 'missed';
}

export function weekStrip(state, userId, today) {
  const { start } = weekBounds(today);
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return labels.map((label, index) => {
    const date = shiftDate(start, index);
    return { date, label, day: Number(date.slice(8, 10)), status: dayStatus(state, userId, date, today) };
  });
}

/** All check-ins (rejected ones included, flagged `invalid`) newest first, within an inclusive date range. */
export function historyEntries(state, userId, { from = null, to = null } = {}) {
  return state.checkIns
    .filter((item) => item.userId === userId && (!from || item.date >= from) && (!to || item.date <= to))
    .sort((a, b) => String(b.completedAt || b.date).localeCompare(String(a.completedAt || a.date)));
}

export function checkedInOn(state, userId, date) {
  return state.checkIns.some((item) => item.userId === userId && item.date === date && !item.invalid);
}

/** A–Z sections by display name; non-letters go under "#". */
export function groupByInitial(people) {
  const groups = new Map();
  [...people]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
    .forEach((person) => {
      const first = String(person.name || '').trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(person);
    });
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '#') - (b === '#') || a.localeCompare(b))
    .map(([letter, members]) => ({ letter, people: members }));
}

export function friendRequestSummary(state) {
  const pending = (state.friendRequests || []).filter((request) => request.status === 'pending');
  return {
    incoming: pending.filter((request) => request.addresseeId === state.currentUserId),
    outgoing: pending.filter((request) => request.requesterId === state.currentUserId),
  };
}

/** Home feed: real check-ins and comebacks. Missed and call-out events stay out of the feed. */
export function feedActivities(activities = []) {
  return activities.filter((activity) => !['missed', 'callout'].includes(activity.type));
}

export function isComeback(activity) {
  return ['recovery', 'recovered'].includes(activity?.type);
}

function visibleNotificationEvents(state, nativeActivities) {
  const nativeActivityCheckInIds = new Set(nativeActivities.map((activity) => activity.checkInId).filter(Boolean));
  return (state?.notificationEvents || []).filter((event) => {
    if (event.category === 'nudge') return false;
    if (event.category === 'friend_activity' && nativeActivityCheckInIds.has(event.metadata?.checkInId)) return false;
    return true;
  });
}

function incomingNudges(state) {
  return (state?.nudges || []).filter((nudge) => nudge.toUserId === state.currentUserId);
}

export function updatesList(state, activities = state?.activities || []) {
  const nudges = incomingNudges(state).map((nudge) => ({
    kind: 'nudge',
    id: `nudge:${nudge.id}`,
    sourceId: nudge.id,
    userId: nudge.fromUserId,
    when: nudge.createdAt,
    message: nudge.message,
    readAt: nudge.readAt || null,
  }));
  const nativeActivities = activities.filter((activity) => !activity.proofPath);
  const activityItems = nativeActivities.map((activity) => ({
    kind: 'activity',
    id: `activity:${activity.id}`,
    sourceId: activity.id,
    userId: activity.userId,
    when: activity.when,
    message: activity.message || `${activity.emoji || '✓'} ${activity.habitTitle || 'Habit'}`,
    activity,
  }));
  const notifications = visibleNotificationEvents(state, nativeActivities).map((event) => ({
    kind: 'notification',
    id: `notification:${event.id}`,
    sourceId: event.id,
    userId: event.sourceUserId || null,
    when: event.createdAt,
    title: event.title || 'Notification',
    message: event.body || '',
    category: event.category,
    deepLink: event.deepLink || null,
  }));
  return [...nudges, ...activityItems, ...notifications].sort((a, b) => new Date(b.when) - new Date(a.when));
}

export function unseenUpdatesCount(state, activities = state?.activities || []) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const nativeActivities = activities.filter((activity) => !activity.proofPath);
  const activityCount = nativeActivities.filter((activity) => new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges(state).filter((nudge) => !nudge.readAt).length;
  const notificationCount = visibleNotificationEvents(state, nativeActivities).filter((event) => new Date(event.createdAt).getTime() > lastSeen).length;
  return activityCount + nudgeCount + notificationCount;
}
