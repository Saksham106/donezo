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
  return [...nudges, ...activities].sort((a, b) => new Date(b.when) - new Date(a.when));
}

function unseenUpdatesCount(state = getState()) {
  const lastSeen = new Date(state?.updatesLastSeenAt || 0).getTime();
  const activityCount = activityList(state).filter((activity) => !activity.proofPath && new Date(activity.when).getTime() > lastSeen).length;
  const nudgeCount = incomingNudges().filter((nudge) => !nudge.readAt).length;
  return activityCount + nudgeCount;
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
app = replace_once(app, old_updates, new_updates, 'updates functions')

old_topbar = '''function topbar() {
  const unread = unseenUpdatesCount();
  const friendsLink = `<button class="friends-toplink" type="button" data-friends aria-label="Open Friends">Friends</button>`;
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button>${friendsLink}<div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open Updates">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}
'''
new_topbar = '''function topbar() {
  const unread = unseenUpdatesCount();
  return `<header class="topbar"><button class="brand brand-button" data-home aria-label="Go to Today"><span>ϟ</span><strong>Donezo</strong></button><div class="top-actions"><button class="top-icon-btn" data-nudge-inbox aria-label="Open Updates">${icon('bolt')}${unread ? `<i>${unread > 9 ? '9+' : unread}</i>` : ''}</button><button class="avatar profile-button" data-settings aria-label="Open settings">${esc(me()?.avatar || '?')}</button></div></header>`;
}
'''
app = replace_once(app, old_topbar, new_topbar, 'topbar')

old_rejections = '''  const rejectionStatus = `<span class="vote-btn proof-rejection-status ${activity.invalid ? 'active' : ''}" aria-label="${activity.invalid ? 'Proof rejected' : `${activity.downvotes || 0} proof rejection${activity.downvotes === 1 ? '' : 's'} so far`}">👎 <span>${rejectionLabel}</span></span>`;
  const proofPreview = showProofActions && activity.proofPath ? `<div class="proof-media" data-proof-image="${esc(activity.proofPath)}" aria-label="${esc(activity.habitTitle)} proof"><span aria-hidden="true">📷</span><small>Loading proof…</small></div>` : '';
  const proofActions = showProofActions && activity.proofPath ? `<div class="proof-actions">${mine ? `${rejectionStatus}${activity.invalid ? `<button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button>` : ''}` : `<button class="vote-btn ${activity.userDownvoted ? 'active' : ''}" data-request-reject="${activity.checkInId}" aria-label="${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}">👎 <span>${rejectionLabel}</span></button>`}</div>` : '';
'''
new_rejections = '''  const rejectionControl = showProofActions && activity.proofPath
    ? mine
      ? `<span class="vote-btn proof-rejection-inline proof-rejection-status ${activity.invalid ? 'active' : ''}" aria-label="${activity.invalid ? 'Proof rejected' : `${activity.downvotes || 0} proof rejection${activity.downvotes === 1 ? '' : 's'} so far`}">👎 <span>${rejectionLabel}</span></span>`
      : `<button type="button" class="vote-btn proof-rejection-inline ${activity.userDownvoted ? 'active' : ''}" data-request-reject="${activity.checkInId}" aria-label="${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}">👎 <span>${rejectionLabel}</span></button>`
    : '';
  const proofPreview = showProofActions && activity.proofPath ? `<div class="proof-media" data-proof-image="${esc(activity.proofPath)}" aria-label="${esc(activity.habitTitle)} proof"><span aria-hidden="true">📷</span><small>Loading proof…</small></div>` : '';
  const proofActions = showProofActions && activity.proofPath && mine && activity.invalid ? `<div class="proof-actions"><button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button></div>` : '';
'''
app = replace_once(app, old_rejections, new_rejections, 'rejection controls')

old_positive = '''  const positiveReactions = `<div class="activity-social-actions"><div><div class="reaction-row" aria-label="React to this check-in">${['👏', '🔥', '💪', '😂'].map((emoji) => { const active = mineReactions.includes(emoji); return `<button type="button" class="reaction-btn ${active ? 'active' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" aria-pressed="${active}">${emoji}<span>${visibleReactionCounts[emoji] || 0}</span></button>`; }).join('')}</div><small class="reaction-summary" aria-live="polite">${esc(reactionSummary)}</small></div><button type="button" class="comment-open" data-comment-open="${activity.checkInId}">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;
'''
new_positive = '''  const reactionButtons = ['👏', '🔥', '💪', '😂'].map((emoji) => { const active = mineReactions.includes(emoji); return `<button type="button" class="reaction-btn ${active ? 'active' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" aria-pressed="${active}">${emoji}<span>${visibleReactionCounts[emoji] || 0}</span></button>`; }).join('');
  const positiveReactions = `<div class="activity-social-actions"><div><div class="reaction-row" aria-label="React to or reject this check-in">${reactionButtons}${rejectionControl}</div><small class="reaction-summary" aria-live="polite">${esc(reactionSummary)}</small></div><button type="button" class="comment-open" data-comment-open="${activity.checkInId}">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;
'''
app = replace_once(app, old_positive, new_positive, 'reaction row')

old_inbox = '''function nudgeInboxSheet() {
  if (!nudgeInboxOpen) return '';
  const updates = updatesList();
  const rows = updates.map((item) => {
    const actor = member(item.userId);
    if (item.kind === 'nudge') {
      return `<article class="inbox-nudge ${item.readAt ? 'read' : ''}"><div><strong>⚡ ${esc(actor?.name || 'Friend')}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></div>${item.readAt ? '<span>Seen</span>' : `<button class="btn small-btn" type="button" data-read-nudge="${item.sourceId}">Got it</button>`}</article>`;
    }
    const activity = item.activity;
    const detail = activity?.habitTitle ? `${activity.emoji || '✓'} ${activity.habitTitle}` : item.message;
    return `<button class="update-activity-row" type="button" data-friend-profile="${item.userId}"><span class="avatar">${esc(actor?.avatar || '?')}</span><span><strong>${esc(actor?.name || 'Friend')}</strong><p>${esc(detail)}</p><small>${esc(formatWhen(item.when))}</small></span></button>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet updates-sheet" role="dialog" aria-modal="true" aria-label="Updates" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">UPDATES</p><h2>${updates.length ? 'What happened' : 'All caught up'}</h2></div><button class="icon-btn" type="button" data-close-inbox aria-label="Close">×</button></div>${rows ? `<div class="inbox-list updates-list">${rows}</div>` : '<div class="empty compact-empty"><b>Quiet right now.</b><p>Nudges and friend activity will show up here.</p></div>'}</section></div>`;
}
'''
new_inbox = '''function nudgeInboxSheet() {
  if (!nudgeInboxOpen) return '';
  const updates = updatesList();
  const rows = updates.map((item) => {
    if (item.kind === 'notification') {
      const mark = ({ reaction: '👏', comment: '💬', due_soon: '⏱', streak_risk: '🔥', challenge_progress: '🏆' })[item.category] || '🔔';
      return `<article class="update-notification-row"><span class="update-notification-mark" aria-hidden="true">${mark}</span><span><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></span></article>`;
    }
    const actor = member(item.userId);
    if (item.kind === 'nudge') {
      return `<article class="inbox-nudge ${item.readAt ? 'read' : ''}"><div><strong>⚡ ${esc(actor?.name || 'Friend')}</strong><p>${esc(item.message)}</p><small>${esc(formatWhen(item.when))}</small></div>${item.readAt ? '<span>Seen</span>' : `<button class="btn small-btn" type="button" data-read-nudge="${item.sourceId}">Got it</button>`}</article>`;
    }
    const activity = item.activity;
    const detail = activity?.habitTitle ? `${activity.emoji || '✓'} ${activity.habitTitle}` : item.message;
    return `<button class="update-activity-row" type="button" data-friend-profile="${item.userId}"><span class="avatar">${esc(actor?.avatar || '?')}</span><span><strong>${esc(actor?.name || 'Friend')}</strong><p>${esc(detail)}</p><small>${esc(formatWhen(item.when))}</small></span></button>`;
  }).join('');
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet updates-sheet" role="dialog" aria-modal="true" aria-label="Updates" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">UPDATES</p><h2>${updates.length ? 'What happened' : 'All caught up'}</h2></div><button class="icon-btn" type="button" data-close-inbox aria-label="Close">×</button></div>${rows ? `<div class="inbox-list updates-list">${rows}</div>` : '<div class="empty compact-empty"><b>Quiet right now.</b><p>Nudges, activity, and notifications will show up here.</p></div>'}</section></div>`;
}
'''
app = replace_once(app, old_inbox, new_inbox, 'updates sheet')

old_source = '''  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Use the camera, pick a saved photo, or paste a screenshot. Large photos are compressed automatically.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button><button class="btn full" type="button" data-proof-paste>Paste copied photo</button></section></div>`;
'''
new_source = '''  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet proof-source-sheet" role="dialog" aria-modal="true" aria-label="Add proof" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">ADD PROOF</p><h2>${esc(habit.emoji)} ${esc(habit.title)}</h2></div><button class="icon-btn" type="button" data-proof-source-close aria-label="Close">×</button></div><p class="proof-sheet-copy">Take one photo, use Dual photo, pick a saved photo, or paste a screenshot. Large photos are compressed automatically.</p><button class="btn primary full" type="button" data-proof-camera>Take photo</button><button class="btn full" type="button" data-proof-dual>Dual photo</button><button class="btn full" type="button" data-proof-gallery>Choose from library</button><button class="btn full" type="button" data-proof-paste>Paste copied photo</button></section></div>`;
'''
app = replace_once(app, old_source, new_source, 'proof picker')

app = replace_once(
    app,
    "  const dual = habit.proofMode === 'dual_photo' && dualProof?.habitId === habit.id;",
    "  const dual = dualProof?.habitId === habit.id;",
    'optional dual review',
)

old_bind = '''  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
'''
new_bind = '''  app.querySelectorAll('[data-proof-camera]').forEach((element) => { element.onclick = () => chooseProofInput(proofInput); });
  app.querySelectorAll('[data-proof-dual]').forEach((element) => { element.onclick = () => {
    if (!proofHabit) return;
    dualProof = createDualProofState(proofHabit);
    proofHabit = null;
    render();
  }; });
  app.querySelectorAll('[data-proof-gallery]').forEach((element) => { element.onclick = () => chooseProofInput(proofGalleryInput); });
'''
app = replace_once(app, old_bind, new_bind, 'dual picker binding')

for marker in ['data-proof-dual', "const dual = dualProof?.habitId === habit.id;", 'proof-rejection-inline', "kind: 'notification'", 'update-notification-row']:
    if marker not in app:
        raise SystemExit(f'missing app postcondition: {marker}')
if 'const friendsLink =' in app:
    raise SystemExit('topbar Friends shortcut survived')
app_path.write_text(app)


store_path = Path('src/store.js')
store = store_path.read_text()

old_load_head = '''    const [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult] = await Promise.all([
      client.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('circle_members')
'''
new_load_head = '''    const [notificationPreferencesResult, notificationEventsResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult] = await Promise.all([
      client.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('notification_events').select('id,source_user_id,category,title,body,deep_link,status,created_at').eq('recipient_user_id', user.id).order('created_at', { ascending: false }).limit(100),
      client.from('circle_members')
'''
store = replace_once(store, old_load_head, new_load_head, 'notification event load')
store = replace_once(
    store,
    '    const firstError = [notificationPreferencesResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult].find((result) => result.error);',
    '    const firstError = [notificationPreferencesResult, notificationEventsResult, membershipsResult, friendshipsResult, requestsResult, userUpdateStateResult].find((result) => result.error);',
    'notification event error handling',
)

old_return_tail = '''    batonHandoffs,
    batonOptedOut: Boolean(rows.batonPreference?.opted_out),
    notificationPreferences,
    updatesLastSeenAt: rows.userUpdateState?.last_seen_at || null,
'''
new_return_tail = '''    batonHandoffs,
    batonOptedOut: Boolean(rows.batonPreference?.opted_out),
    notificationPreferences,
    notificationEvents: (rows.notificationEvents || []).map((event) => ({
      id: event.id,
      sourceUserId: event.source_user_id || null,
      category: event.category,
      title: event.title || 'Notification',
      body: event.body || '',
      deepLink: event.deep_link || null,
      status: event.status,
      createdAt: event.created_at,
    })),
    updatesLastSeenAt: rows.userUpdateState?.last_seen_at || null,
'''
store = replace_once(store, old_return_tail, new_return_tail, 'notification event state mapping')
store = replace_once(
    store,
    '''      notificationPreferences,
      userUpdateState: userUpdateStateResult.data,
''',
    '''      notificationPreferences,
      notificationEvents: notificationEventsResult.data || [],
      userUpdateState: userUpdateStateResult.data,
''',
    'notification event map input',
)
for marker in ["from('notification_events').select(", "eq('recipient_user_id', user.id)", 'notificationEvents:']:
    if marker not in store:
        raise SystemExit(f'missing store postcondition: {marker}')
store_path.write_text(store)


css_path = Path('social.css')
css = css_path.read_text()
if '.proof-rejection-inline{' in css or '.update-notification-row{' in css:
    raise SystemExit('polish CSS markers already exist')
css += '''

/* Compact proof moderation + unified in-app notification rows. */
.proof-rejection-inline{margin-left:auto;flex:0 0 auto}
.update-notification-row{display:grid;grid-template-columns:2.5rem minmax(0,1fr);align-items:center;gap:var(--space-3);padding:var(--space-3);border:var(--rule-hairline) solid var(--color-rule);border-radius:var(--radius-md);background:var(--color-surface)}
.update-notification-mark{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:var(--radius-round);background:var(--color-paper-2);font-size:1.1rem}
.update-notification-row strong,.update-notification-row p,.update-notification-row small{display:block}.update-notification-row p{margin:.15rem 0 0;color:var(--color-muted);font-size:var(--text-xs);line-height:1.35}.update-notification-row small{margin-top:.2rem;color:var(--color-muted);font-size:var(--text-2xs)}
'''
css_path.write_text(css)
