const FREQUENCIES = new Set(['daily', 'selected_weekdays', 'weekly']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;
const DAY_NAMES = new Map([
  ['sunday', 0], ['sun', 0], ['monday', 1], ['mon', 1], ['tuesday', 2], ['tue', 2],
  ['wednesday', 3], ['wed', 3], ['thursday', 4], ['thu', 4], ['friday', 5], ['fri', 5],
  ['saturday', 6], ['sat', 6],
]);

function assertDate(value, name = 'date') {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new Error(`Invalid ${name}`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function assertTime(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) throw new Error('Invalid due time');
  const [hour, minute, second = '0'] = value.split(':');
  const milliseconds = second.includes('.') ? Number(`0.${second.split('.')[1]}`) * 1000 : 0;
  return `${hour}:${minute}:${second.slice(0, 2).padStart(2, '0')}${milliseconds ? `.${String(Math.round(milliseconds)).padStart(3, '0')}` : ''}`;
}

function dateParts(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, month, day };
}

function dateAtNoon(dateString) {
  const { year, month, day } = dateParts(dateString);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = dateAtNoon(dateString);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function dayOfWeek(dateString) {
  return dateAtNoon(dateString).getUTCDay();
}

function normalizeWeekdays(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((entry) => {
    if (typeof entry === 'string' && DAY_NAMES.has(entry.toLowerCase())) return DAY_NAMES.get(entry.toLowerCase());
    const day = Number(entry);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Weekdays must be integers from 0 (Sunday) to 6 (Saturday)');
    return day;
  }))].sort((a, b) => a - b);
}

function normalizePauseWindows(value) {
  return (Array.isArray(value) ? value : []).map((window) => {
    const startDate = window.startDate ?? window.start_date;
    const endDate = window.endDate ?? window.end_date ?? startDate;
    assertDate(startDate, 'pause start date');
    assertDate(endDate, 'pause end date');
    if (endDate < startDate) throw new Error('Pause window end date must be on or after its start date');
    return { startDate, endDate };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function validateTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  return timezone;
}

export function normalizeSchedule(input = {}) {
  const frequencyInput = input.frequency ?? input.scheduleFrequency ?? input.schedule_frequency ?? 'daily';
  const aliases = { weekdays: 'selected_weekdays', 'selected-weekdays': 'selected_weekdays', selectedWeekdays: 'selected_weekdays' };
  const frequency = aliases[frequencyInput] || frequencyInput;
  if (!FREQUENCIES.has(frequency)) throw new Error(`Unsupported schedule frequency: ${frequency}`);

  const startDate = input.startDate ?? input.start_date ?? input.effectiveFrom ?? input.effective_from ?? null;
  const endDate = input.endDate ?? input.end_date ?? input.effectiveUntil ?? input.effective_until ?? null;
  if (startDate != null) assertDate(startDate, 'start date');
  if (endDate != null) assertDate(endDate, 'end date');
  if (startDate && endDate && endDate < startDate) throw new Error('End date must be on or after start date');

  const rawQuantity = input.targetQuantity ?? input.target_quantity ?? input.quantity ?? 1;
  const targetQuantity = Number(rawQuantity);
  if (!Number.isFinite(targetQuantity) || targetQuantity <= 0) throw new Error('Target quantity must be greater than zero');
  const graceMinutes = Number(input.graceMinutes ?? input.grace_minutes ?? 0);
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0) throw new Error('Grace minutes must be a non-negative integer');

  const timezone = validateTimeZone(input.timezone ?? input.scheduleTimezone ?? input.schedule_timezone ?? 'UTC');
  const weekdays = normalizeWeekdays(input.weekdays ?? input.daysOfWeek ?? input.scheduleWeekdays ?? input.schedule_weekdays ?? input.dayOfWeek ?? input.day_of_week);
  if (frequency === 'selected_weekdays' && weekdays.length === 0) throw new Error('Selected weekday schedules need at least one weekday');
  const dueTime = assertTime(input.dueTime ?? input.due_time ?? input.targetTime ?? input.target_time ?? null);
  const intervalWeeks = Number(input.intervalWeeks ?? input.interval_weeks ?? 1);
  if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1) throw new Error('Interval weeks must be a positive integer');

  return {
    ...input,
    frequency,
    weekdays,
    targetQuantity,
    targetUnit: String(input.targetUnit ?? input.target_unit ?? input.unit ?? 'count').trim() || 'count',
    dueTime,
    graceMinutes,
    timezone,
    startDate,
    endDate,
    intervalWeeks,
    pauseWindows: normalizePauseWindows(input.pauseWindows ?? input.pause_windows),
  };
}

function localDateTimeParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function timezoneOffsetMs(value, timezone) {
  const parts = localDateTimeParts(value, timezone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - value.getTime();
}

function localPartsMatch(value, wanted, timezone) {
  const actual = localDateTimeParts(value, timezone);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].every((key) => Number(actual[key]) === Number(wanted[key]));
}

/** Convert a wall-clock date/time to an instant, choosing the earlier offset in a fall-back hour. */
export function localDateTimeToUtc(dateString, timeString, timezone = 'UTC') {
  assertDate(dateString);
  const normalizedTime = assertTime(timeString);
  if (!normalizedTime) return null;
  const [hour, minute, secondPart = '0'] = normalizedTime.split(':');
  const second = Number(secondPart.split('.')[0]);
  const wanted = { ...dateParts(dateString), hour: Number(hour), minute: Number(minute), second };
  const base = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  const offsets = new Set();
  for (const delta of [-172800000, -86400000, 0, 86400000, 172800000]) {
    offsets.add(timezoneOffsetMs(new Date(base + delta), timezone));
  }
  const candidates = [...offsets]
    .map((offset) => new Date(base - offset))
    .filter((candidate) => localPartsMatch(candidate, wanted, timezone))
    .sort((a, b) => a - b);
  if (candidates.length) return candidates[0].toISOString();
  // A spring-forward wall-clock time does not exist. Resolve it using the
  // pre-transition offset, which moves the instant forward by the gap.
  const fallback = new Date(base - timezoneOffsetMs(new Date(base), timezone));
  return fallback.toISOString();
}

function isoWeekKey(dateString) {
  const date = dateAtNoon(dateString);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4, 12));
  const firstWeekday = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstWeekday);
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function weeksBetween(startDate, endDate) {
  return Math.floor((dateAtNoon(endDate) - dateAtNoon(startDate)) / 604800000);
}

export function resolveScheduleVersion(versions, localDate) {
  assertDate(localDate);
  const matching = (versions || [])
    .map((version) => ({ version, from: version.effectiveFrom ?? version.effective_from, until: version.effectiveUntil ?? version.effective_until ?? null }))
    .filter(({ from, until }) => from && from <= localDate && (!until || localDate < until))
    .sort((a, b) => a.from.localeCompare(b.from) || Number(a.version.version ?? 0) - Number(b.version.version ?? 0));
  return matching.at(-1)?.version ?? null;
}

function selectedVersion(schedule, localDate) {
  if (!Array.isArray(schedule?.versions)) return { schedule, version: schedule.version ?? null };
  const version = resolveScheduleVersion(schedule.versions, localDate);
  return { schedule: version ? { ...schedule, ...version } : schedule, version: version?.version ?? null };
}

function isPaused(schedule, date) {
  return schedule.pauseWindows.some((window) => window.startDate <= date && date <= window.endDate);
}

function weeklyDateMatches(schedule, date) {
  const weekday = schedule.weekdays[0] ?? (schedule.startDate ? dayOfWeek(schedule.startDate) : 1);
  if (dayOfWeek(date) !== weekday) return false;
  if (!schedule.startDate) return true;
  const anchor = schedule.startDate;
  if (date < anchor) return false;
  return weeksBetween(anchor, date) % schedule.intervalWeeks === 0;
}

function dueDetails(schedule, date) {
  if (!schedule.dueTime) return { dueAt: null, graceUntil: null };
  const dueAt = localDateTimeToUtc(date, schedule.dueTime, schedule.timezone);
  const graceUntil = new Date(new Date(dueAt).getTime() + schedule.graceMinutes * 60000).toISOString();
  return { dueAt, graceUntil };
}

export function getScheduleOccurrence(input, localDate) {
  assertDate(localDate);
  const selected = selectedVersion(input || {}, localDate);
  const schedule = normalizeSchedule(selected.schedule);
  const paused = isPaused(schedule, localDate);
  const inRange = (!schedule.startDate || localDate >= schedule.startDate) && (!schedule.endDate || localDate <= schedule.endDate);
  let scheduled = schedule.frequency === 'daily'
    ? inRange
    : schedule.frequency === 'selected_weekdays'
      ? inRange && schedule.weekdays.includes(dayOfWeek(localDate))
      : inRange && weeklyDateMatches(schedule, localDate);
  if (paused) scheduled = false;
  return {
    date: localDate,
    scheduled,
    paused,
    frequency: schedule.frequency,
    weekdays: schedule.weekdays,
    targetQuantity: schedule.targetQuantity,
    targetUnit: schedule.targetUnit,
    timezone: schedule.timezone,
    ...dueDetails(schedule, localDate),
    weekKey: isoWeekKey(localDate),
    scheduleVersion: selected.version,
  };
}

export const occurrenceForDate = getScheduleOccurrence;
export const getScheduleForDate = getScheduleOccurrence;

export function listScheduleOccurrences(input, fromDate, toDate) {
  assertDate(fromDate, 'from date');
  assertDate(toDate, 'to date');
  if (toDate < fromDate) return [];
  const occurrences = [];
  for (let cursor = fromDate; cursor <= toDate; cursor = addDays(cursor, 1)) {
    occurrences.push(getScheduleOccurrence(input, cursor));
  }
  return occurrences;
}

export const getScheduleOccurrences = listScheduleOccurrences;
export const occurrencesBetween = listScheduleOccurrences;

export function isScheduledOnDate(input, localDate) {
  return getScheduleOccurrence(input, localDate).scheduled;
}

function quantityFromCompletion(completion) {
  if (completion == null) return 0;
  if (typeof completion === 'number') return Math.max(0, completion);
  if (Array.isArray(completion)) return completion.reduce((sum, item) => sum + quantityFromCompletion(item), 0);
  return Math.max(0, Number(completion.completedQuantity ?? completion.quantity ?? completion.amount ?? 0) || 0);
}

export function evaluateScheduleDate(input, localDate, completion = {}) {
  const occurrence = getScheduleOccurrence(input, localDate);
  const completedQuantity = quantityFromCompletion(completion);
  const remainingQuantity = Math.max(0, occurrence.targetQuantity - completedQuantity);
  const achieved = occurrence.scheduled && completedQuantity >= occurrence.targetQuantity;
  let status;
  if (!occurrence.scheduled) status = occurrence.paused ? 'paused' : 'not_scheduled';
  else if (achieved) status = 'complete';
  else if (!occurrence.dueAt) status = 'due';
  else {
    const now = new Date(completion.now ?? Date.now());
    if (now < new Date(occurrence.dueAt)) status = 'upcoming';
    else if (now <= new Date(occurrence.graceUntil)) status = 'grace';
    else status = 'overdue';
  }
  return { ...occurrence, completedQuantity, remainingQuantity, achieved, status };
}

export const scheduleProgressForDate = evaluateScheduleDate;
export const getScheduleStatus = evaluateScheduleDate;
