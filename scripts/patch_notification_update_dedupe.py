from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

app_path = Path('src/app.js')
app = app_path.read_text()

old_updates = '''function updatesList(state = getState()) {
  const nudges = incomingNudges().map((nudge) => ({
    kind: 'nudge',
    id: `nudge:${nudge.id}`,
    sourceId: nudge.id,
    userId: nudge.fromUserId,
    when: nudge.createdAt,
    message: nudge.message,
    readAt: nudge.readAt || null,
  }));
  const activities = activityList(state).filter((activity) => !activity.proofPath).map((activity) => ({
    kind: 'activity',
    id: `activity:${activity.id}`,
    sourceId: activity.id,
    userId: activity.userId,
    when: activity.when,
    message: activity.message || `${activity.emoji || '✓'} ${activity.habitTitle || 'Habit'}`,
    activity,
  }));
  const notifications = (state?.notificationEvents || [])
    .filter((event) => !['nudge', 'friend_activity'].includes(event.category))
    .map((event) => ({
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
  return [...nudges, ...activities, ...notifications].sort((a, b) => new Date(b.when) - new Date(a.when));
}

function unseenUpdatesCount(state = getState()) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const activityCount = activityList(state).filter((activity) => !activity.proofPath && new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges().filter((nudge) => !nudge.readAt).length;
  const notificationCount = (state?.notificationEvents || []).filter((event) => !['nudge', 'friend_activity'].includes(event.category) && new Date(event.createdAt).getTime() > lastSeen).length;
  return activityCount + nudgeCount + notificationCount;
}
'''
new_updates = '''function updatesList(state = getState()) {
  const nudges = incomingNudges().map((nudge) => ({
    kind: 'nudge',
    id: `nudge:${nudge.id}`,
    sourceId: nudge.id,
    userId: nudge.fromUserId,
    when: nudge.createdAt,
    message: nudge.message,
    readAt: nudge.readAt || null,
  }));
  const nativeActivities = activityList(state).filter((activity) => !activity.proofPath);
  const activities = nativeActivities.map((activity) => ({
    kind: 'activity',
    id: `activity:${activity.id}`,
    sourceId: activity.id,
    userId: activity.userId,
    when: activity.when,
    message: activity.message || `${activity.emoji || '✓'} ${activity.habitTitle || 'Habit'}`,
    activity,
  }));
  const nativeActivityCheckInIds = new Set(nativeActivities.map((activity) => activity.checkInId).filter(Boolean));
  const visibleNotificationEvents = (state?.notificationEvents || []).filter((event) => {
    if (event.category === 'nudge') return false;
    if (event.category === 'friend_activity' && nativeActivityCheckInIds.has(event.metadata?.checkInId)) return false;
    return true;
  });
  const notifications = visibleNotificationEvents.map((event) => ({
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
  return [...nudges, ...activities, ...notifications].sort((a, b) => new Date(b.when) - new Date(a.when));
}

function unseenUpdatesCount(state = getState()) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const nativeActivities = activityList(state).filter((activity) => !activity.proofPath);
  const activityCount = nativeActivities.filter((activity) => new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges().filter((nudge) => !nudge.readAt).length;
  const nativeActivityCheckInIds = new Set(nativeActivities.map((activity) => activity.checkInId).filter(Boolean));
  const visibleNotificationEvents = (state?.notificationEvents || []).filter((event) => {
    if (event.category === 'nudge') return false;
    if (event.category === 'friend_activity' && nativeActivityCheckInIds.has(event.metadata?.checkInId)) return false;
    return true;
  });
  const notificationCount = visibleNotificationEvents.filter((event) => new Date(event.createdAt).getTime() > lastSeen).length;
  return activityCount + nudgeCount + notificationCount;
}
'''
app = replace_once(app, old_updates, new_updates, 'Updates notification dedupe')
app_path.write_text(app)

store_path = Path('src/store.js')
store = store_path.read_text()
store = replace_once(
    store,
    ".select('id,source_user_id,category,title,body,deep_link,status,created_at')",
    ".select('id,source_user_id,category,title,body,deep_link,status,created_at,metadata')",
    'notification event metadata select',
)
store = replace_once(
    store,
    "      status: event.status,\n      createdAt: event.created_at,",
    "      status: event.status,\n      createdAt: event.created_at,\n      metadata: event.metadata || {},",
    'notification event metadata mapping',
)
store_path.write_text(store)

for path in [app_path, store_path]:
    if not path.read_text().strip():
        raise SystemExit(f'empty output: {path}')
