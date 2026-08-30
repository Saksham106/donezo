const GROUP_WINDOW_MS = 10 * 60 * 1000;

function relativeTime(value, nowValue = new Date()) {
  const timestamp = new Date(value).getTime();
  const now = new Date(nowValue).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function contextualHabitStatus(habit = {}, { now = new Date(), date = null } = {}) {
  const completedAt = habit.completedAt || habit.completed_at;
  if (completedAt) {
    const when = relativeTime(completedAt, now);
    return when ? `Done ${when}` : 'Done';
  }
  if (habit.invalid) return 'Proof needs another try';

  const targetTime = habit.targetTime || habit.target_time;
  if (!targetTime) return 'Due today';
  const localDate = date || new Date(now).toISOString().slice(0, 10);
  const clock = String(targetTime).slice(0, 5);
  const due = new Date(`${localDate}T${clock}:00`);
  const current = new Date(now);
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(current.getTime())) return 'Due today';
  const minutes = Math.round((due.getTime() - current.getTime()) / 60_000);
  if (minutes > 90) return `Due in ${Math.round(minutes / 60)}h`;
  if (minutes > 0) return `Due in ${minutes}m`;
  if (minutes >= -60) return 'Due now';
  return `Late by ${Math.max(1, Math.round(Math.abs(minutes) / 60))}h · still counts`;
}

function canGroup(activity, commentedIds) {
  return activity
    && activity.type === 'checkin'
    && !activity.proofPath
    && !activity.invalid
    && !commentedIds.has(activity.checkInId);
}

export function groupSquadActivity(activities = [], comments = []) {
  const commentedIds = new Set(comments.map((comment) => comment.checkInId || comment.check_in_id));
  const result = [];
  for (const activity of activities) {
    const previous = result.at(-1);
    const previousItem = previous?.type === 'grouped_checkin' ? previous.items.at(-1) : previous;
    const closeInTime = previousItem
      && Math.abs(new Date(previousItem.when).getTime() - new Date(activity.when).getTime()) <= GROUP_WINDOW_MS;
    const sameHabit = previousItem?.habitTitle === activity.habitTitle;
    if (canGroup(activity, commentedIds) && canGroup(previousItem, commentedIds) && closeInTime && sameHabit) {
      if (previous.type === 'grouped_checkin') previous.items.push(activity);
      else result.splice(result.length - 1, 1, { type: 'grouped_checkin', habitTitle: activity.habitTitle, emoji: activity.emoji, when: previous.when, items: [previous, activity] });
    } else {
      result.push(activity);
    }
  }
  return result;
}

export { relativeTime };
