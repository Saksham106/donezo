const NOTIFICATION_CATEGORIES = Object.freeze([
  'due_soon',
  'streak_risk',
  'friend_activity',
  'nudge',
  'reaction',
  'comment',
  'challenge_progress',
]);

const DEFAULT_CATEGORIES = Object.freeze(Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((category) => [category, true]),
));

function validCategory(category) {
  return NOTIFICATION_CATEGORIES.includes(category);
}

function validTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeMinutes(value) {
  if (!validTime(value)) throw new Error(`Invalid quiet-hours time: ${value}`);
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function preferenceParts(preferences = {}) {
  const quietHours = preferences.quietHours || {};
  return {
    timezone: preferences.timezone || 'UTC',
    quietHours: {
      enabled: Boolean(quietHours.enabled ?? preferences.quietHoursEnabled),
      start: quietHours.start || preferences.quietHoursStart || '22:00',
      end: quietHours.end || preferences.quietHoursEnd || '08:00',
    },
    categories: preferences.categories || preferences.enabledCategories || DEFAULT_CATEGORIES,
    habitOverrides: preferences.habitOverrides || preferences.habitPreferences || preferences.habits || {},
  };
}

function localMinutes(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid notification time');
  if (!validTimeZone(timeZone)) throw new Error(`Invalid notification timezone: ${timeZone}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function isWithinQuietHours(value, preferences = {}) {
  const { timezone, quietHours } = preferenceParts(preferences);
  if (!quietHours.enabled) return false;
  const start = timeMinutes(quietHours.start);
  const end = timeMinutes(quietHours.end);
  if (start === end) return false;
  const current = localMinutes(value, timezone);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function habitOverride(category, habitId, preferences) {
  if (!habitId) return undefined;
  const override = preferenceParts(preferences).habitOverrides?.[habitId];
  if (typeof override === 'boolean') return override;
  if (override && typeof override === 'object' && typeof override[category] === 'boolean') {
    return override[category];
  }
  return undefined;
}

export function evaluateNotificationPreferences({ category, habitId = null, at = new Date(), preferences = {} } = {}) {
  if (!validCategory(category)) return { allowed: false, reason: 'unknown_category' };
  const parts = preferenceParts(preferences);
  const override = habitOverride(category, habitId, preferences);
  if (override === false) return { allowed: false, reason: 'habit_disabled' };
  if (override !== true && typeof parts.categories[category] === 'boolean' && !parts.categories[category]) {
    return { allowed: false, reason: 'category_disabled' };
  }
  try {
    if (isWithinQuietHours(at, preferences)) return { allowed: false, reason: 'quiet_hours' };
  } catch {
    return { allowed: false, reason: 'invalid_preferences' };
  }
  return { allowed: true, reason: 'allowed' };
}

export function getNotificationCopy(category, context = {}) {
  const actor = context.actorName || 'A friend';
  const habit = context.habitTitle || 'your habit';
  const progress = Number.isFinite(Number(context.progress)) ? `${Number(context.progress)}%` : 'your squad';
  const copy = {
    due_soon: {
      title: `A quick nudge for ${habit}`,
      body: `You planned ${habit} soon. A small step now keeps your plan moving.`,
    },
    streak_risk: {
      title: 'Keep your streak going',
      body: `${habit} is still open today. One small step keeps your momentum.`,
    },
    friend_activity: {
      title: `${actor} checked in`,
      body: `${actor} finished ${habit}. Join them when it works for you.`,
    },
    nudge: {
      title: `${actor} sent you a nudge`,
      body: context.message || `Your friend is checking in about ${habit}.`,
    },
    reaction: {
      title: `${actor} reacted to your check-in`,
      body: `${actor} left a reaction on ${habit}.`,
    },
    comment: {
      title: `${actor} commented on your check-in`,
      body: `${actor} added context to your ${habit} check-in.`,
    },
    challenge_progress: {
      title: 'Squad progress update',
      body: `Your squad is ${progress} through the challenge. Keep going at your pace.`,
    },
  };
  if (!validCategory(category)) throw new Error(`Unknown notification category: ${category}`);
  return copy[category];
}

export function getNotificationDeepLink(category, context = {}) {
  const encoded = (value) => encodeURIComponent(String(value));
  if (!validCategory(category)) throw new Error(`Unknown notification category: ${category}`);
  if (category === 'nudge') return '/?nudges=1';
  if (category === 'due_soon' || category === 'streak_risk') {
    if (!context.habitId) throw new Error('habitId is required for habit notifications');
    return `/?tab=checkin&habit=${encoded(context.habitId)}`;
  }
  if (category === 'friend_activity' || category === 'reaction' || category === 'comment') {
    if (!context.checkInId) throw new Error('checkInId is required for check-in notifications');
    return `/?tab=friends&checkIn=${encoded(context.checkInId)}`;
  }
  if (!context.circleId) throw new Error('circleId is required for challenge notifications');
  return `/?tab=league&circle=${encoded(context.circleId)}`;
}

export function parseNotificationDeepLink(value, base = 'https://donezo.app') {
  let url;
  try {
    url = new URL(value || '/', base);
  } catch {
    url = new URL('/', base);
  }
  const allowedTabs = new Set(['today', 'friends', 'checkin', 'league', 'me']);
  const requestedTab = url.searchParams.get('tab');
  const normalizedTab = requestedTab === 'squad' ? 'friends' : requestedTab;
  return {
    tab: allowedTabs.has(normalizedTab) ? normalizedTab : 'today',
    checkInId: url.searchParams.get('checkIn'),
    habitId: url.searchParams.get('habit'),
    circleId: url.searchParams.get('circle'),
    nudgesOpen: url.searchParams.get('nudges') === '1',
  };
}

function eventSubject(input = {}) {
  return input.subjectId || input.checkInId || input.nudgeId || input.habitId || input.circleId || 'general';
}

export function notificationDedupeKey(input = {}) {
  const parts = [
    'donezo',
    'v1',
    input.recipientUserId,
    input.category,
    eventSubject(input),
    input.occurrence || 'once',
  ].map((part) => {
    const value = String(part ?? '');
    return `${value.length}:${value}`;
  });
  return parts.join('|');
}

export function buildNotificationEvent(input = {}) {
  const { recipientUserId, category, at = new Date(), preferences = {}, context = {} } = input;
  if (!recipientUserId) throw new Error('recipientUserId is required');
  if (!validCategory(category)) throw new Error(`Unknown notification category: ${category}`);
  const habitId = input.habitId || context.habitId || null;
  const checkInId = input.checkInId || context.checkInId || null;
  const circleId = input.circleId || context.circleId || null;
  const policy = evaluateNotificationPreferences({ category, habitId, at, preferences });
  if (!policy.allowed) return null;
  const copy = getNotificationCopy(category, context);
  const targetContext = { ...context, habitId, checkInId, circleId, nudgeId: input.nudgeId || context.nudgeId };
  const deepLink = getNotificationDeepLink(category, targetContext);
  const dedupeKey = notificationDedupeKey(input);
  const groupKey = input.groupKey || `${recipientUserId}:${category}:${eventSubject(input)}`;
  return {
    recipientUserId,
    category,
    habitId,
    title: copy.title,
    body: copy.body,
    deepLink,
    dedupeKey,
    groupKey,
    grouping: { key: groupKey, category, subjectId: eventSubject(input) },
    metadata: { ...context, reason: policy.reason },
  };
}

export { NOTIFICATION_CATEGORIES };

export function getNotificationCapability(env = globalThis) {
  const NotificationApi = env.Notification;
  const navigatorApi = env.navigator;
  if (!NotificationApi || !navigatorApi?.serviceWorker) return { supported: false, permission: 'unsupported' };
  return { supported: true, permission: NotificationApi.permission || 'default' };
}

export function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function sameApplicationServerKey(subscription, expected) {
  const existing = subscription?.options?.applicationServerKey;
  if (!existing) return false;
  const actual = new Uint8Array(existing);
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

export async function syncPushSubscription(repo) {
  const capability = getNotificationCapability(window);
  if (!capability.supported || capability.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) return false;
  const publicKey = await repo.getVapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  await repo.savePushSubscription(subscription);
  return true;
}

export async function enableNotifications(repo) {
  const capability = getNotificationCapability(window);
  if (!capability.supported) return capability;
  await navigator.serviceWorker.register('/sw.js');
  const permission = capability.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  let pushRegistered = false;
  if (permission === 'granted' && repo) {
    try {
      pushRegistered = await syncPushSubscription(repo);
    } catch {
      pushRegistered = false;
    }
  }
  return { supported: true, permission, pushRegistered };
}

export async function sendTestNotification() {
  const capability = getNotificationCapability(window);
  if (!capability.supported || capability.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Donezo 🔥', {
    body: 'Notifications are ready. Now your friends can annoy you properly.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'donezo-test',
    data: { url: '/' },
  });
  return true;
}
