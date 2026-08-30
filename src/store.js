import {
  calculateBestStreak,
  calculateStreak,
  localDateInTimeZone,
  rejectedCheckInIds,
} from './domain.js';
import { getScheduleOccurrence, normalizeSchedule } from './schedule.js';
import { validateStake } from './stakes.js';
import { validateCommentBody } from './social-domain.js';
import { computeEarnedBadges } from './badges-domain.js';
import { buildMonthlyWrapped } from './wrapped-domain.js';

const clone = (value) => structuredClone(value);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function appError(error, fallback) {
  const message = error?.message || fallback;
  return new Error(message);
}

export function validateHabitInput(input = {}) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 80) throw new Error('Habit name must be 1–80 characters');
  const emoji = String(input.emoji || '').trim();
  if (!emoji || emoji.length > 16) throw new Error('Choose a valid emoji');
  const targetTime = input.targetTime == null ? '' : String(input.targetTime).trim();
  if (targetTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) throw new Error('Enter a valid target time');
  const proofMode = String(input.proofMode || '');
  if (!['photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');
  return { title, emoji, targetTime, proofMode };
}

export function proofObjectPath(userId, habitId, mimeType, timestamp = Date.now()) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error('Unsupported image type');
  if (!/^[a-zA-Z0-9-]+$/.test(userId) || !/^[a-zA-Z0-9-]+$/.test(habitId)) {
    throw new Error('Invalid proof path');
  }
  return `${userId}/${habitId}-${timestamp}.${extension}`;
}

function dateInTimezone(timeZone) {
  return localDateInTimeZone(new Date(), timeZone || 'UTC');
}

export function mapDatabaseState(user, rows) {
  const profile = rows.profile || {
    id: user.id,
    display_name: user.email?.split('@')[0] || 'You',
    username: null,
    avatar_url: null,
    timezone: 'UTC',
  };
  const rawNotificationPreferences = rows.notificationPreferences || {};
  const notificationPreferences = {
    timezone: rawNotificationPreferences.timezone || profile.timezone || 'UTC',
    quietHoursEnabled: Boolean(rawNotificationPreferences.quiet_hours_enabled),
    quietHoursStart: String(rawNotificationPreferences.quiet_hours_start || '22:00').slice(0, 5),
    quietHoursEnd: String(rawNotificationPreferences.quiet_hours_end || '08:00').slice(0, 5),
    categories: rawNotificationPreferences.categories || {
      due_soon: true, streak_risk: true, friend_activity: true, nudge: true,
      reaction: true, comment: true, challenge_progress: true,
    },
    habitOverrides: rawNotificationPreferences.habit_overrides || {},
  };
  const memberRows = rows.members?.length
    ? rows.members
    : [{ user_id: user.id, profiles: profile }];
  const memberProfileById = new Map(memberRows.map((membership) => {
    const memberProfile = membership.profiles || {};
    return [membership.user_id || memberProfile.id, memberProfile];
  }));
  const circles = (rows.circles || (rows.circle ? [rows.circle] : [])).map((circle) => ({
    id: circle.id,
    name: circle.name,
    inviteCode: circle.invite_code,
    ownerId: circle.owner_id,
    role: circle.role || 'member',
  }));
  const sharesByHabit = new Map();
  for (const share of rows.habitShares || []) {
    const ids = sharesByHabit.get(share.habit_id) || [];
    if (!ids.includes(share.circle_id)) ids.push(share.circle_id);
    sharesByHabit.set(share.habit_id, ids);
  }

  const pausesByHabit = new Map();
  for (const pause of rows.schedulePauses || []) {
    const pauses = pausesByHabit.get(pause.habit_id) || [];
    pauses.push({
      id: pause.id,
      startDate: pause.start_date,
      endDate: pause.end_date,
      reason: pause.reason || '',
    });
    pausesByHabit.set(pause.habit_id, pauses);
  }
  const versionsByHabit = new Map();
  for (const version of rows.scheduleVersions || []) {
    const versions = versionsByHabit.get(version.habit_id) || [];
    versions.push({
      id: version.id,
      version: Number(version.version),
      effectiveFrom: version.effective_from,
      effectiveUntil: version.effective_until,
      frequency: version.schedule_frequency,
      weekdays: version.schedule_weekdays || [],
      targetQuantity: Number(version.target_quantity ?? 1),
      targetUnit: version.target_unit || 'count',
      dueTime: version.due_time?.slice(0, 5) || null,
      graceMinutes: Number(version.grace_minutes || 0),
      timezone: version.timezone || 'UTC',
    });
    versionsByHabit.set(version.habit_id, versions);
  }

  const habits = (rows.habits || []).map((habit) => {
    const ownerProfile = memberProfileById.get(habit.owner_id) || {};
    const ownerTimeZone = ownerProfile.timezone || 'UTC';
    return {
      id: habit.id,
      circleId: habit.circle_id,
      squadIds: sharesByHabit.get(habit.id) || [habit.circle_id],
      ownerId: habit.owner_id,
      title: habit.title,
      emoji: habit.emoji,
      frequency: habit.frequency,
      scheduleFrequency: habit.schedule_frequency || habit.frequency || 'daily',
      scheduleWeekdays: habit.schedule_weekdays || [],
      targetQuantity: Number(habit.target_quantity ?? 1),
      targetUnit: habit.target_unit || 'count',
      targetTime: (habit.due_time || habit.target_time)?.slice(0, 5) || '',
      graceMinutes: Number(habit.grace_minutes || 0),
      scheduleTimezone: habit.schedule_timezone || ownerTimeZone,
      pauseWindows: pausesByHabit.get(habit.id) || [],
      scheduleVersions: versionsByHabit.get(habit.id) || [],
      proofMode: habit.proof_mode,
      xp: habit.xp,
      active: habit.active,
      createdAt: habit.created_at || null,
      updatedAt: habit.updated_at || null,
      ownerTimeZone,
      createdDate: habit.created_at ? localDateInTimeZone(habit.created_at, ownerTimeZone) : null,
      archivedDate: habit.active === false && habit.updated_at
        ? localDateInTimeZone(habit.updated_at, ownerTimeZone)
        : null,
    };
  });
  const habitById = new Map(habits.map((habit) => [habit.id, habit]));
  const rawCheckIns = (rows.checkIns || [])
    .filter((checkIn) => habitById.has(checkIn.habit_id))
    .map((checkIn) => ({
      id: checkIn.id,
      habitId: checkIn.habit_id,
      userId: checkIn.user_id,
      date: checkIn.check_date,
      completedAt: checkIn.completed_at,
      completedQuantity: Number(checkIn.completed_quantity ?? 1),
      proofPath: checkIn.proof_path,
      note: checkIn.note,
    }));
  const checkInIds = new Set(rawCheckIns.map((checkIn) => checkIn.id));
  const reactions = (rows.reactions || []).filter((reaction) => checkInIds.has(reaction.check_in_id)).map((reaction) => ({
    id: reaction.id,
    checkInId: reaction.check_in_id,
    userId: reaction.user_id,
    emoji: reaction.emoji,
    createdAt: reaction.created_at,
  }));
  const rejectedIds = rejectedCheckInIds(rawCheckIns, reactions, memberRows.length);
  const checkIns = rawCheckIns.map((checkIn) => {
    const downvoteUsers = new Set(reactions
      .filter((reaction) => reaction.checkInId === checkIn.id && reaction.emoji === '👎' && reaction.userId !== checkIn.userId)
      .map((reaction) => reaction.userId));
    return {
      ...checkIn,
      invalid: rejectedIds.has(checkIn.id),
      downvotes: downvoteUsers.size,
      userDownvoted: downvoteUsers.has(user.id),
    };
  });

  const today = rows.today || dateInTimezone(profile.timezone);
  const members = memberRows.map((membership) => {
    const memberProfile = membership.profiles || {};
    const memberId = membership.user_id || memberProfile.id;
    const validCheckIns = checkIns.filter((checkIn) => checkIn.userId === memberId && !checkIn.invalid);
    const dates = [...new Set(validCheckIns.map((checkIn) => checkIn.date))];
    const xp = validCheckIns.reduce((total, checkIn) => total + (habitById.get(checkIn.habitId)?.xp || 0), 0);
    const name = memberProfile.display_name || memberProfile.username || 'Friend';
    return {
      id: memberId,
      name,
      handle: memberProfile.username ? `@${memberProfile.username}` : '',
      avatar: initials(name),
      avatarUrl: memberProfile.avatar_url,
      timeZone: memberProfile.timezone || 'UTC',
      joinedDate: memberProfile.created_at || membership.joined_at || null,
      xp,
      currentStreak: calculateStreak(dates, today),
      bestStreak: calculateBestStreak(dates),
      awardOptOut: memberProfile.recap_awards_enabled === false,
    };
  });
  const memberById = new Map(members.map((member) => [member.id, member]));
  const checkInActivities = checkIns
    .map((checkIn) => {
      const habit = habitById.get(checkIn.habitId);
      const actor = memberById.get(checkIn.userId);
      const activityReactions = reactions.filter((reaction) => reaction.checkInId === checkIn.id && reaction.emoji !== '👎');
      const reactionCounts = activityReactions.reduce((counts, reaction) => {
        counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
        return counts;
      }, {});
      return {
        id: checkIn.id,
        checkInId: checkIn.id,
        userId: checkIn.userId,
        type: 'completed',
        habitTitle: habit?.title || 'Habit',
        emoji: habit?.emoji || '⚡',
        when: checkIn.completedAt,
        streak: actor?.currentStreak || 0,
        message: checkIn.invalid ? 'Proof got cooked 💀 — run it back.' : (checkIn.note || 'Done. Proof beats promises.'),
        proofPath: checkIn.proofPath,
        invalid: checkIn.invalid,
        downvotes: checkIn.downvotes,
        userDownvoted: checkIn.userDownvoted,
        reactionCounts,
        userReactions: activityReactions.filter((reaction) => reaction.userId === user.id).map((reaction) => reaction.emoji),
      };
    });
  const nudges = (rows.nudges || []).map((nudge) => ({
    id: nudge.id,
    circleId: nudge.circle_id,
    fromUserId: nudge.from_user_id,
    toUserId: nudge.to_user_id,
    message: nudge.message,
    visibility: nudge.visibility || 'private',
    createdAt: nudge.created_at,
    readAt: nudge.read_at,
  }));
  const calloutActivities = nudges
    .filter((nudge) => nudge.visibility === 'squad')
    .map((nudge) => ({
      id: `callout-${nudge.id}`,
      nudgeId: nudge.id,
      userId: nudge.fromUserId,
      toUserId: nudge.toUserId,
      type: 'callout',
      when: nudge.createdAt,
      message: nudge.message,
    }));
  const challenges = (rows.challenges || []).map((challenge) => ({
    id: challenge.id,
    circleId: challenge.circle_id,
    createdBy: challenge.created_by,
    kind: challenge.kind,
    title: challenge.title,
    target: challenge.target,
    startsOn: challenge.starts_on,
    endsOn: challenge.ends_on,
    status: challenge.status,
    resolvedAt: challenge.resolved_at,
  }));
  const recoveries = (rows.recoveries || []).map((recovery) => ({
    id: recovery.id,
    habitId: recovery.habit_id,
    userId: recovery.user_id,
    missedDate: recovery.missed_date,
    recoveredAt: recovery.recovered_at,
    recoveredDate: recovery.recovered_at ? localDateInTimeZone(recovery.recovered_at, memberProfileById.get(recovery.user_id)?.timezone || 'UTC') : null,
    action: recovery.action,
    reflection: recovery.reflection,
    visibility: recovery.visibility,
    createdAt: recovery.created_at,
  }));
  const recoveryActivities = recoveries.flatMap((recovery) => {
    const habit = habitById.get(recovery.habitId);
    const miss = {
      id: `miss-${recovery.id}`,
      userId: recovery.userId,
      type: 'missed',
      habitTitle: habit?.title || 'Habit',
      emoji: habit?.emoji || '↩',
      when: `${recovery.missedDate}T12:00:00Z`,
      message: 'Missed it. Kept the receipt and made a next move.',
    };
    const actionMessages = {
      recover_today: 'Bounced back today.',
      adjust_habit: 'Adjusted the plan instead of forcing a bad one.',
      pause_habit: 'Set up a pause and protected the long game.',
      ask_support: 'Asked the squad for a hand.',
    };
    const recoveryActivity = {
      id: `recovery-${recovery.id}`,
      userId: recovery.userId,
      type: recovery.recoveredAt ? 'recovered' : 'recovery',
      habitTitle: habit?.title || 'Habit',
      emoji: habit?.emoji || '↩',
      when: recovery.recoveredAt || recovery.createdAt,
      message: actionMessages[recovery.action] || 'Made a comeback plan.',
    };
    return [recoveryActivity, miss];
  });
  const friendActivities = [...checkInActivities, ...calloutActivities, ...recoveryActivities]
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .slice(0, 40);
  const stakes = (rows.stakes || []).map((stake) => ({
    id: stake.id,
    circleId: stake.circle_id,
    challengeId: stake.challenge_id,
    createdBy: stake.created_by,
    rule: stake.rule,
    reward: stake.reward || '',
    consequence: stake.consequence || '',
    startsOn: stake.starts_on,
    endsOn: stake.ends_on,
    status: stake.status,
    resolution: stake.resolution,
    activatedAt: stake.activated_at,
    resolvedAt: stake.resolved_at,
  }));
  const stakeConsents = (rows.stakeConsents || []).map((consent) => ({
    stakeId: consent.stake_id,
    userId: consent.user_id,
    status: consent.status,
    respondedAt: consent.responded_at,
  }));
  const currentCircleId = rows.circle?.id || null;
  const comments = (rows.comments || [])
    .filter((comment) => checkInIds.has(comment.check_in_id) && memberProfileById.has(comment.author_id) && (!currentCircleId || comment.circle_id === currentCircleId))
    .map((comment) => ({
      id: comment.id,
      checkInId: comment.check_in_id,
      circleId: comment.circle_id,
      authorId: comment.author_id,
      body: comment.body,
      createdAt: comment.created_at,
    }));
  const batonRows = (rows.batons || []).filter((baton) => (!currentCircleId || baton.circle_id === currentCircleId));
  const activeBaton = batonRows.find((baton) => baton.active && new Date(baton.expires_at).getTime() > Date.now()) || null;
  const baton = activeBaton ? {
    id: activeBaton.id,
    circleId: activeBaton.circle_id,
    holderUserId: activeBaton.holder_user_id,
    sourceCheckInId: activeBaton.source_check_in_id,
    startedAt: activeBaton.started_at,
    handedAt: activeBaton.handed_at,
    expiresAt: activeBaton.expires_at,
    active: true,
  } : null;
  const batonHandoffs = (rows.batonHandoffs || [])
    .filter((handoff) => (!currentCircleId || handoff.circle_id === currentCircleId) && batonRows.some((item) => item.id === handoff.baton_id))
    .map((handoff) => ({
      id: handoff.id,
      batonId: handoff.baton_id,
      circleId: handoff.circle_id,
      fromUserId: handoff.from_user_id,
      toUserId: handoff.to_user_id,
      sourceCheckInId: handoff.source_check_in_id,
      handedAt: handoff.handed_at,
      expiresAt: handoff.expires_at,
    }));

  return {
    currentUserId: user.id,
    circles,
    circleId: rows.circle?.id || null,
    circleName: rows.circle?.name || null,
    circleInviteCode: rows.circle?.invite_code || null,
    members,
    habits,
    checkIns,
    reactions,
    friendActivities,
    nudges,
    challenges,
    recoveries,
    stakes,
    stakeConsents,
    comments,
    baton,
    batonHandoffs,
    batonOptedOut: Boolean(rows.batonPreference?.opted_out),
    notificationPreferences,
  };
}

export function createSupabaseRepository(client, user) {
  let state = mapDatabaseState(user, {});

  async function ensureProfile() {
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw appError(error, 'Could not load profile');
    if (data) return data;
    const displayName = user.user_metadata?.display_name?.trim()
      || user.email?.split('@')[0]
      || 'Donezo user';
    const { data: inserted, error: insertError } = await client.from('profiles').upsert({
      id: user.id,
      display_name: displayName,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    }, { onConflict: 'id' }).select().single();
    if (insertError) throw appError(insertError, 'Could not create profile');
    return inserted;
  }

  async function load(requestedCircleId = state.circleId) {
    const profile = await ensureProfile();
    const { data: notificationPreferences, error: notificationPreferencesError } = await client
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (notificationPreferencesError) throw appError(notificationPreferencesError, 'Could not load notification settings');
    const { data: memberships, error: membershipError } = await client
      .from('circle_members')
      .select('circle_id, role, joined_at, circles!circle_members_circle_id_fkey(id,name,invite_code,owner_id)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true });
    if (membershipError) throw appError(membershipError, 'Could not load your squads');
    const circles = (memberships || []).map((membership) => ({
      ...membership.circles,
      role: membership.role,
      joinedAt: membership.joined_at,
    })).filter((circle) => circle.id);
    const circle = circles.find((item) => item.id === requestedCircleId) || circles[0] || null;
    if (!circle) {
      state = mapDatabaseState(user, { profile, notificationPreferences, circles: [], circle: null, members: [], habits: [], habitShares: [], checkIns: [], reactions: [], nudges: [], challenges: [], recoveries: [], stakes: [], stakeConsents: [], comments: [], batons: [], batonHandoffs: [], batonPreference: null });
      return getState();
    }

    const [membersResult, sharedHabitsResult, nudgesResult, challengesResult, stakesResult, batonPreferenceResult] = await Promise.all([
      client.from('circle_members')
        .select('user_id, role, joined_at, profiles!circle_members_user_id_fkey(id,username,display_name,avatar_url,timezone,created_at,recap_awards_enabled)')
        .eq('circle_id', circle.id)
        .order('joined_at', { ascending: true }),
      client.from('habit_circles')
        .select('habit_id,circle_id,habits!inner(*)')
        .eq('circle_id', circle.id)
        .order('shared_at'),
      client.from('nudges').select('*').eq('circle_id', circle.id).order('created_at', { ascending: false }).limit(100),
      client.from('weekly_challenges').select('*').eq('circle_id', circle.id).order('starts_on', { ascending: false }).limit(20),
      client.from('group_stakes').select('*').eq('circle_id', circle.id).order('starts_on', { ascending: false }).limit(20),
      client.from('baton_preferences').select('opted_out').eq('user_id', user.id).maybeSingle(),
    ]);
    const failed = [membersResult, sharedHabitsResult, nudgesResult, challengesResult, stakesResult, batonPreferenceResult].find((result) => result.error);
    if (failed) throw appError(failed.error, 'Could not load Donezo data');
    const habits = (sharedHabitsResult.data || []).map((share) => share.habits).filter(Boolean);
    const habitIds = habits.map((habit) => habit.id);
    const stakeIds = (stakesResult.data || []).map((stake) => stake.id);
    const [habitSharesResult, checkInsResult, recoveriesResult, stakeConsentsResult, schedulePausesResult, scheduleVersionsResult] = await Promise.all([
      habitIds.length
        ? client.from('habit_circles').select('habit_id,circle_id').in('habit_id', habitIds)
        : Promise.resolve({ data: [], error: null }),
      habitIds.length
        ? client.from('check_ins').select('*').in('habit_id', habitIds).order('completed_at', { ascending: false }).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      habitIds.length
        ? client.from('habit_recoveries').select('*').in('habit_id', habitIds).order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null }),
      stakeIds.length
        ? client.from('stake_consents').select('*').in('stake_id', stakeIds)
        : Promise.resolve({ data: [], error: null }),
      habitIds.length
        ? client.from('habit_schedule_pauses').select('*').in('habit_id', habitIds).order('start_date', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      habitIds.length
        ? client.from('habit_schedule_versions').select('*').in('habit_id', habitIds).order('effective_from', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const loadError = habitSharesResult.error || checkInsResult.error || recoveriesResult.error || stakeConsentsResult.error || schedulePausesResult.error || scheduleVersionsResult.error;
    if (loadError) {
      throw appError(loadError, 'Could not load Donezo data');
    }
    const checkInIds = checkInsResult.data.map((checkIn) => checkIn.id);
    const [reactionsResult, commentsResult, batonsResult, batonHandoffsResult] = await Promise.all([
      checkInIds.length
        ? client.from('reactions').select('*').in('check_in_id', checkInIds).order('created_at')
        : Promise.resolve({ data: [], error: null }),
      checkInIds.length
        ? client.from('check_in_comments').select('*').in('check_in_id', checkInIds).order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      client.from('batons').select('*').eq('circle_id', circle.id).eq('active', true),
      client.from('baton_handoffs').select('*').eq('circle_id', circle.id).order('handed_at', { ascending: true }).limit(1000),
    ]);
    const socialLoadError = reactionsResult.error || commentsResult.error || batonsResult.error || batonHandoffsResult.error;
    if (socialLoadError) throw appError(socialLoadError, 'Could not load social activity');
    state = mapDatabaseState(user, {
      profile,
      circles,
      circle,
      members: membersResult.data,
      habits,
      habitShares: habitSharesResult.data,
      checkIns: checkInsResult.data,
      reactions: reactionsResult.data,
      nudges: nudgesResult.data,
      challenges: challengesResult.data,
      recoveries: recoveriesResult.data,
      stakes: stakesResult.data,
      stakeConsents: stakeConsentsResult.data,
      schedulePauses: schedulePausesResult.data,
      scheduleVersions: scheduleVersionsResult.data,
      comments: commentsResult.data,
      batons: batonsResult.data,
      batonHandoffs: batonHandoffsResult.data,
      batonPreference: batonPreferenceResult.data,
      notificationPreferences,
    });
    return getState();
  }

  async function selectCircle(circleId) {
    if (!state.circles.some((circle) => circle.id === circleId)) throw new Error('You are not in that squad');
    return load(circleId);
  }

  function getState() {
    return clone(state);
  }

  async function createCircle(name) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 60) throw new Error('Squad name must be 1–60 characters');
    const { data, error } = await client.from('circles').insert({ name: cleanName, owner_id: user.id }).select('id').single();
    if (error) throw appError(error, 'Could not create squad');
    return load(data.id);
  }

  async function joinCircle(inviteCode) {
    const code = inviteCode.trim().toLowerCase();
    if (!/^[a-z0-9]{12}$/.test(code)) throw new Error('Enter the 12-character invite code');
    const { data, error } = await client.rpc('join_circle', { supplied_code: code });
    if (error) throw appError(error, 'Invalid or expired invite code');
    return load(data);
  }

  async function updateDisplayName(displayName) {
    const cleanName = displayName.trim();
    if (!cleanName || cleanName.length > 60) throw new Error('Name must be 1–60 characters');
    const { error } = await client.from('profiles').update({ display_name: cleanName }).eq('id', user.id);
    if (error) throw appError(error, 'Could not update your name');
    return load();
  }

  async function saveNotificationPreferences(input = {}) {
    const normalizeTime = (value, fallback) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : fallback;
    const timezone = String(input.timezone || state.notificationPreferences?.timezone || 'UTC');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new Error('Choose a valid timezone');
    }
    const categoryNames = ['due_soon', 'streak_risk', 'friend_activity', 'nudge', 'reaction', 'comment', 'challenge_progress'];
    const categories = Object.fromEntries(categoryNames.map((category) => [category, input.categories?.[category] !== false]));
    const habitOverrides = Object.fromEntries(Object.entries(input.habitOverrides || {}).map(([habitId, enabled]) => [habitId, Boolean(enabled)]));
    const { error } = await client.from('notification_preferences').upsert({
      user_id: user.id,
      timezone,
      quiet_hours_enabled: Boolean(input.quietHoursEnabled),
      quiet_hours_start: normalizeTime(input.quietHoursStart, '22:00'),
      quiet_hours_end: normalizeTime(input.quietHoursEnd, '08:00'),
      categories,
      habit_overrides: habitOverrides,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw appError(error, 'Could not save notification settings');
    return load(state.circleId);
  }

  async function setRecapAwardsEnabled(enabled) {
    const { error } = await client.from('profiles').update({ recap_awards_enabled: Boolean(enabled) }).eq('id', user.id);
    if (error) throw appError(error, 'Could not save recap preference');
    return load(state.circleId);
  }

  async function saveHabitSchedule(habitId, input) {
    const fallbackTimeZone = state.members.find((member) => member.id === user.id)?.timeZone || 'UTC';
    const schedule = normalizeSchedule({
      frequency: input.scheduleFrequency || input.frequency || 'daily',
      weekdays: input.scheduleWeekdays || [],
      targetQuantity: input.targetQuantity ?? 1,
      targetUnit: input.targetUnit || 'count',
      dueTime: input.targetTime || null,
      graceMinutes: input.graceMinutes ?? 0,
      timezone: input.scheduleTimezone || fallbackTimeZone,
    });
    const { error } = await client.rpc('create_habit_schedule_version', {
      target_habit_id: habitId,
      p_effective_from: dateInTimezone(schedule.timezone),
      p_schedule_frequency: schedule.frequency,
      p_schedule_weekdays: schedule.weekdays,
      p_target_quantity: schedule.targetQuantity,
      p_target_unit: schedule.targetUnit,
      p_due_time: schedule.dueTime,
      p_grace_minutes: schedule.graceMinutes,
      p_timezone: schedule.timezone,
    });
    if (error) throw appError(error, 'Could not save the habit schedule');
  }

  async function addHabit(input) {
    if (!state.circleId) throw new Error('Create or join a squad first');
    const clean = validateHabitInput({
      title: input.title,
      emoji: input.emoji || '⚡',
      targetTime: input.targetTime || '',
      proofMode: input.proofMode || 'photo',
    });
    const squadIds = [...new Set(input.squadIds?.length ? input.squadIds : [state.circleId])];
    const { data: habitId, error } = await client.rpc('create_habit_with_squads', {
      requested_squads: squadIds,
      habit_title: clean.title,
      habit_emoji: clean.emoji,
      // The legacy metadata RPC intentionally accepts only `daily`. The real
      // cadence lives in the immutable schedule version written below.
      habit_frequency: 'daily',
      habit_target_time: clean.targetTime || null,
      habit_proof_mode: clean.proofMode,
    });
    if (error) throw appError(error, 'Could not add habit');
    if (input.scheduleFrequency || (input.frequency && input.frequency !== 'daily')) await saveHabitSchedule(habitId, input);
    await load(state.circleId);
    return state.habits.find((habit) => habit.id === habitId) || { id: habitId };
  }

  function ownedHabit(habitId) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (!habit || habit.ownerId !== user.id) {
      throw new Error('You can only manage your own habit');
    }
    return habit;
  }

  function fullTargetFor(habit, date) {
    try {
      return getScheduleOccurrence({
        frequency: habit.scheduleFrequency || habit.frequency || 'daily',
        weekdays: habit.scheduleWeekdays || [],
        targetQuantity: habit.targetQuantity ?? 1,
        targetUnit: habit.targetUnit || 'count',
        dueTime: habit.targetTime || null,
        graceMinutes: habit.graceMinutes || 0,
        timezone: habit.scheduleTimezone || habit.ownerTimeZone || 'UTC',
        startDate: habit.createdDate || null,
        pauseWindows: habit.pauseWindows || [],
        versions: habit.scheduleVersions || [],
      }, date).targetQuantity;
    } catch {
      return Number(habit.targetQuantity ?? 1);
    }
  }

  async function updateHabit(habitId, input) {
    const habit = ownedHabit(habitId);
    const clean = validateHabitInput(input);
    const squadIds = [...new Set(input.squadIds?.length ? input.squadIds : habit.squadIds)];
    const scheduleChanged = Boolean(input.scheduleFrequency) && (
      input.scheduleFrequency !== (habit.scheduleFrequency || habit.frequency || 'daily')
      || (input.scheduleWeekdays || []).join(',') !== (habit.scheduleWeekdays || []).join(',')
      || Number(input.targetQuantity ?? 1) !== Number(habit.targetQuantity ?? 1)
      || String(input.targetUnit || 'count').trim() !== String(habit.targetUnit || 'count')
      || String(input.targetTime || '') !== String(habit.targetTime || '')
      || Number(input.graceMinutes || 0) !== Number(habit.graceMinutes || 0)
      || String(input.scheduleTimezone || habit.scheduleTimezone || '') !== String(habit.scheduleTimezone || '')
    );
    const { data: updatedId, error } = await client.rpc('update_habit_with_squads', {
      target_habit_id: habitId,
      requested_squads: squadIds,
      habit_title: clean.title,
      habit_emoji: clean.emoji,
      // Keep the legacy column compatible; schedule versions are authoritative.
      habit_frequency: 'daily',
      habit_target_time: clean.targetTime || null,
      habit_proof_mode: clean.proofMode,
    });
    if (error) throw appError(error, 'Could not save habit');
    if (!updatedId) throw new Error('Habit could not be updated. Refresh and try again.');
    if (scheduleChanged) await saveHabitSchedule(habitId, input);
    await load(state.circleId);
    return state.habits.find((item) => item.id === habitId) || { id: updatedId };
  }

  async function archiveHabit(habitId) {
    ownedHabit(habitId);
    const { data: archived, error } = await client.from('habits').update({
      active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', habitId).eq('owner_id', user.id).select('*').maybeSingle();
    if (error) throw appError(error, 'Could not archive habit');
    if (!archived) throw new Error('Habit could not be archived. Refresh and try again.');
    await load();
    return state.habits.find((habit) => habit.id === habitId);
  }

  async function pauseHabit(habitId, input) {
    ownedHabit(habitId);
    const startDate = String(input.startDate || '');
    const endDate = String(input.endDate || '');
    const reason = String(input.reason || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Choose a start and end date');
    if (endDate < startDate) throw new Error('Pause end must be on or after start');
    if (reason.length > 280) throw new Error('Pause note must be 280 characters or less');
    const { error } = await client.rpc('create_habit_schedule_pause', {
      target_habit_id: habitId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_reason: reason || null,
    });
    if (error) throw appError(error, 'Could not pause the habit');
    await load(state.circleId);
    return state.habits.find((habit) => habit.id === habitId);
  }

  async function toggleHabit(habitId, date) {
    const habit = ownedHabit(habitId);
    const existing = state.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === user.id && checkIn.date === date);
    if (existing && !existing.invalid) {
      const { error } = await client.from('check_ins').delete().eq('id', existing.id).eq('user_id', user.id);
      if (error) throw appError(error, 'Could not undo check-in');
      if (existing.proofPath) {
        const { error: cleanupError } = await client.storage.from('proofs').remove([existing.proofPath]);
        if (cleanupError) {
          await load();
          throw appError(cleanupError, 'Check-in undone, but its proof could not be removed');
        }
      }
    } else {
      if (existing?.invalid) {
        const { error: deleteError } = await client.from('check_ins').delete().eq('id', existing.id).eq('user_id', user.id);
        if (deleteError) throw appError(deleteError, 'Could not clear rejected check-in');
      }
      const { error } = await client.from('check_ins').insert({
        habit_id: habitId,
        user_id: user.id,
        check_date: date,
        completed_quantity: fullTargetFor(habit, date),
      });
      if (error) throw appError(error, 'Could not complete habit');
    }
    return load();
  }

  async function completeWithProof(habitId, date, file) {
    const habit = ownedHabit(habitId);
    const existing = state.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === user.id && checkIn.date === date);
    if (existing && !existing.invalid) throw new Error('Already checked in today');
    const oldProofPath = existing?.proofPath || null;
    const path = proofObjectPath(user.id, habitId, file.type);
    const { error: uploadError } = await client.storage.from('proofs').upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw appError(uploadError, 'Could not upload proof');
    if (existing?.invalid) {
      const { error: deleteError } = await client.from('check_ins').delete().eq('id', existing.id).eq('user_id', user.id);
      if (deleteError) {
        await client.storage.from('proofs').remove([path]);
        throw appError(deleteError, 'Could not replace rejected proof');
      }
    }
    const { error: checkInError } = await client.from('check_ins').insert({
      habit_id: habitId,
      user_id: user.id,
      check_date: date,
      completed_quantity: fullTargetFor(habit, date),
      proof_path: path,
    });
    if (checkInError) {
      const { error: cleanupError } = await client.storage.from('proofs').remove([path]);
      if (cleanupError) throw new Error(`${checkInError.message || 'Could not save check-in'}; uploaded proof cleanup also failed`);
      throw appError(checkInError, 'Could not save check-in');
    }
    if (oldProofPath && oldProofPath !== path) await client.storage.from('proofs').remove([oldProofPath]);
    return load();
  }

  async function toggleDownvote(checkInId) {
    const checkIn = state.checkIns.find((item) => item.id === checkInId);
    if (!checkIn?.proofPath) throw new Error('Nothing to vote on');
    if (checkIn.userId === user.id) throw new Error('You cannot cook your own proof 😭');
    const existing = state.reactions.find((reaction) => reaction.checkInId === checkInId && reaction.userId === user.id && reaction.emoji === '👎');
    if (existing) {
      const { error } = await client.from('reactions').delete().eq('id', existing.id).eq('user_id', user.id);
      if (error) throw appError(error, 'Could not remove vote');
    } else {
      const { error } = await client.from('reactions').insert({ check_in_id: checkInId, user_id: user.id, emoji: '👎' });
      if (error) throw appError(error, 'Could not downvote proof');
    }
    return load();
  }

  async function toggleReaction(checkInId, emoji) {
    if (!['👏', '🔥', '💪', '😂'].includes(emoji)) throw new Error('Choose a supported reaction');
    const checkIn = state.checkIns.find((item) => item.id === checkInId);
    if (!checkIn) throw new Error('That update is no longer available');
    const existing = state.reactions.find((reaction) => reaction.checkInId === checkInId && reaction.userId === user.id && reaction.emoji === emoji);
    if (existing) {
      const { error } = await client.from('reactions').delete().eq('id', existing.id).eq('user_id', user.id);
      if (error) throw appError(error, 'Could not remove reaction');
    } else {
      const { error } = await client.from('reactions').insert({ check_in_id: checkInId, user_id: user.id, emoji });
      if (error) throw appError(error, 'Could not react');
    }
    return load();
  }

  async function recoverHabit(habitId, missedDate, input = {}) {
    const habit = ownedHabit(habitId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(missedDate) || missedDate >= dateInTimezone(habit.scheduleTimezone || habit.ownerTimeZone || 'UTC')) throw new Error('Choose a past missed date');
    const action = String(input.action || 'recover_today');
    if (!['recover_today', 'adjust_habit', 'pause_habit', 'ask_support'].includes(action)) throw new Error('Choose a recovery action');
    const reflection = String(input.reflection || '').trim();
    if (reflection.length > 280) throw new Error('Keep the reflection under 280 characters');
    const visibility = input.visibility === 'squad' ? 'squad' : 'private';
    const { error } = await client.from('habit_recoveries').upsert({
      habit_id: habitId,
      user_id: user.id,
      missed_date: missedDate,
      recovered_at: action === 'recover_today' ? new Date().toISOString() : null,
      action,
      reflection: reflection || null,
      visibility,
    }, { onConflict: 'habit_id,user_id,missed_date' });
    if (error) throw appError(error, 'Could not save recovery');
    return load();
  }

  async function createChallenge(input = {}) {
    if (!state.circleId) throw new Error('Create or join a squad first');
    const kind = String(input.kind || 'completion_percent');
    if (!['completion_percent', 'total_completions', 'no_consecutive_miss'].includes(kind)) throw new Error('Choose a valid challenge');
    const target = Number(input.target || (kind === 'completion_percent' ? 80 : kind === 'no_consecutive_miss' ? 1 : 20));
    const title = String(input.title || '').trim();
    if (!title || title.length > 80) throw new Error('Challenge title must be 1–80 characters');
    const { error } = await client.from('weekly_challenges').insert({
      circle_id: state.circleId,
      created_by: user.id,
      kind,
      title,
      target,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    });
    if (error) throw appError(error, 'Could not start challenge');
    return load();
  }

  async function createStake(input = {}) {
    if (!state.circleId) throw new Error('Create or join a squad first');
    const clean = validateStake(input);
    const { data, error } = await client.from('group_stakes').insert({
      circle_id: state.circleId,
      challenge_id: input.challengeId || null,
      created_by: user.id,
      rule: clean.rule,
      reward: clean.reward || null,
      consequence: clean.consequence || null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    }).select('id').single();
    if (error) throw appError(error, 'Could not propose stake');
    const result = await client.rpc('respond_to_stake', { target_stake: data.id, response: 'accepted' });
    if (result.error) throw appError(result.error, 'Stake created, but your opt-in failed');
    return load();
  }

  async function respondToStake(stakeId, response) {
    if (!['accepted', 'declined'].includes(response)) throw new Error('Choose accept or decline');
    const { error } = await client.rpc('respond_to_stake', { target_stake: stakeId, response });
    if (error) throw appError(error, 'Could not respond to stake');
    return load();
  }

  async function resolveGroupStake(stakeId, resolution) {
    const stake = state.stakes.find((item) => item.id === stakeId);
    if (!stake || stake.createdBy !== user.id || stake.status !== 'active') throw new Error('Only the creator can settle an active stake');
    const timeZone = state.members.find((item) => item.id === user.id)?.timeZone || 'UTC';
    if (dateInTimezone(timeZone) <= stake.endsOn) throw new Error('Settle the stake after it ends');
    const cleanResolution = {
      winners: Array.isArray(resolution?.winners) ? resolution.winners.map(String) : [],
      losers: Array.isArray(resolution?.losers) ? resolution.losers.map(String) : [],
      allSucceeded: Boolean(resolution?.allSucceeded),
    };
    const { data, error } = await client.from('group_stakes').update({
      status: 'resolved',
      resolution: cleanResolution,
      resolved_at: new Date().toISOString(),
    }).eq('id', stakeId).eq('created_by', user.id).eq('status', 'active').select('id').maybeSingle();
    if (error) throw appError(error, 'Could not settle stake');
    if (!data) throw new Error('Stake is no longer active');
    return load();
  }

  async function sendNudge(toUserId, message, visibility = 'squad') {
    if (!state.circleId) throw new Error('Create or join a squad first');
    if (!['private', 'squad'].includes(visibility)) throw new Error('Choose public or private');
    const cleanMessage = message.trim();
    if (!cleanMessage || cleanMessage.length > 140) throw new Error('Nudge must be 1–140 characters');
    const { data, error } = await client.from('nudges').insert({
      circle_id: state.circleId,
      from_user_id: user.id,
      to_user_id: toUserId,
      message: cleanMessage,
      visibility,
    }).select('id').single();
    if (error) throw appError(error, 'Could not send nudge');
    let pushSent = false;
    try {
      const { error: pushError } = await client.functions.invoke('send-nudge', {
        body: { action: 'send-nudge', nudgeId: data.id },
      });
      pushSent = !pushError;
    } catch {
      pushSent = false;
    }
    await load();
    return { pushSent, nudgeId: data.id };
  }

  async function markNudgeRead(nudgeId) {
    const { error } = await client.from('nudges').update({ read_at: new Date().toISOString() }).eq('id', nudgeId).eq('to_user_id', user.id);
    if (error) throw appError(error, 'Could not mark nudge read');
    return load();
  }

  async function startBaton(recipientUserId, sourceCheckInId) {
    if (!state.circleId) throw new Error('Create or join a squad first');
    const checkIn = state.checkIns.find((item) => item.id === sourceCheckInId && item.userId === user.id && !item.invalid);
    if (!checkIn) throw new Error('Choose one of your valid check-ins');
    if (!state.members.some((member) => member.id === recipientUserId && member.id !== user.id)) throw new Error('Recipient must be another active circle member');
    const { data, error } = await client.rpc('start_baton', { source_check_in_id: sourceCheckInId, recipient_user_id: recipientUserId });
    if (error) throw appError(error, 'Could not start baton');
    await load(state.circleId);
    return data;
  }

  async function passBaton(recipientUserId, sourceCheckInId) {
    const baton = state.baton;
    if (!baton || !baton.active) throw new Error('No active baton');
    if (baton.holderUserId !== user.id) throw new Error('Only the current baton holder can pass it');
    const checkIn = state.checkIns.find((item) => item.id === sourceCheckInId && item.userId === user.id && !item.invalid);
    if (!checkIn) throw new Error('Choose one of your valid check-ins');
    if (!state.members.some((member) => member.id === recipientUserId && member.id !== user.id)) throw new Error('Recipient must be another active circle member');
    const { data, error } = await client.rpc('pass_baton', { target_baton_id: baton.id, recipient_user_id: recipientUserId, source_check_in_id: sourceCheckInId });
    if (error) throw appError(error, 'Could not pass baton');
    await load(state.circleId);
    return data;
  }

  async function setBatonOptOut(enabled) {
    const { data, error } = await client.rpc('set_baton_opt_out', { enabled: Boolean(enabled) });
    if (error) throw appError(error, 'Could not save baton preference');
    await load(state.circleId);
    return data;
  }

  async function addComment(checkInId, body) {
    if (!state.checkIns.some((item) => item.id === checkInId)) throw new Error('That check-in is no longer available');
    const { data, error } = await client.rpc('add_check_in_comment', { target_check_in_id: checkInId, comment_body: validateCommentBody(body) });
    if (error) throw appError(error, 'Could not add comment');
    await load(state.circleId);
    return state.comments.find((comment) => comment.id === data?.id) || data;
  }

  async function deleteComment(commentId) {
    const comment = state.comments.find((item) => item.id === commentId);
    if (!comment || comment.authorId !== user.id) throw new Error('You can only delete your own comment');
    const { error } = await client.rpc('delete_check_in_comment', { target_comment_id: commentId });
    if (error) throw appError(error, 'Could not delete comment');
    return load(state.circleId);
  }

  function getEarnedBadges(options = {}) {
    const profile = state.members.find((member) => member.id === user.id);
    return computeEarnedBadges({ userId: user.id, members: state.members, habits: state.habits, checkIns: state.checkIns, batonHandoffs: state.batonHandoffs, asOfDate: options.asOfDate || dateInTimezone(profile?.timeZone || 'UTC'), joinedDate: options.joinedDate || profile?.joinedDate, timeZone: options.timeZone || profile?.timeZone || 'UTC' });
  }

  function getMonthlyWrapped(month, options = {}) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Month must use YYYY-MM');
    return buildMonthlyWrapped({ month, circleId: state.circleId, members: state.members, habits: state.habits, checkIns: state.checkIns, reactions: state.reactions, comments: state.comments, batonHandoffs: state.batonHandoffs, nudges: state.nudges, asOfDate: options.asOfDate || dateInTimezone(options.timeZone || 'UTC'), timeZone: options.timeZone || 'UTC', recapEnabled: options.recapEnabled !== false, recapOptOut: Boolean(options.recapOptOut) });
  }

  async function getVapidPublicKey() {
    const { data, error } = await client.functions.invoke('send-nudge', { body: { action: 'vapid-public-key' } });
    if (error || !data?.publicKey) throw appError(error, 'Push setup is not ready yet');
    return data.publicKey;
  }

  async function savePushSubscription(subscription) {
    const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) throw new Error('Invalid push subscription');
    const { error } = await client.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw appError(error, 'Could not save push subscription');
    return true;
  }

  async function getProofUrl(path) {
    const { data, error } = await client.storage.from('proofs').createSignedUrl(path, 300);
    if (error) throw appError(error, 'Could not open proof');
    return data.signedUrl;
  }

  return {
    getState,
    load,
    selectCircle,
    createCircle,
    joinCircle,
    updateDisplayName,
    saveNotificationPreferences,
    setRecapAwardsEnabled,
    addHabit,
    updateHabit,
    archiveHabit,
    pauseHabit,
    toggleHabit,
    completeWithProof,
    toggleDownvote,
    toggleReaction,
    recoverHabit,
    createChallenge,
    createStake,
    respondToStake,
    resolveStake: resolveGroupStake,
    sendNudge,
    markNudgeRead,
    startBaton,
    passBaton,
    setBatonOptOut,
    addComment,
    deleteComment,
    getEarnedBadges,
    getMonthlyWrapped,
    getVapidPublicKey,
    savePushSubscription,
    getProofUrl,
  };
}

// Kept as a tiny deterministic test double for domain tests. Production uses
// createSupabaseRepository exclusively.
export function createMemoryRepository(seed, onChange = () => {}) {
  const state = clone(seed);
  const emit = () => onChange(clone(state));
  function getState() { return clone(state); }

  function toggleHabit(habitId, date, proofUrl) {
    const existingIndex = state.checkIns.findIndex((checkIn) => checkIn.habitId === habitId && checkIn.userId === state.currentUserId && checkIn.date === date);
    const habit = state.habits.find((item) => item.id === habitId);
    const member = state.members.find((item) => item.id === state.currentUserId);
    if (!habit || !member) return;
    if (existingIndex >= 0) {
      state.checkIns.splice(existingIndex, 1);
      member.xp = Math.max(0, member.xp - habit.xp);
    } else {
      state.checkIns.unshift({
        id: uid('checkin'),
        habitId,
        userId: state.currentUserId,
        date,
        completedAt: new Date().toISOString(),
        completedQuantity: Number(habit.targetQuantity ?? 1),
        proofUrl: proofUrl || null,
      });
      member.xp += habit.xp;
    }
    emit();
  }

  function completeWithProof(habitId, date, proofUrl) {
    const already = state.checkIns.some((checkIn) => checkIn.habitId === habitId && checkIn.userId === state.currentUserId && checkIn.date === date);
    if (!already) toggleHabit(habitId, date, proofUrl);
  }

  function addHabit(input) {
    const clean = validateHabitInput({ title: input.title, emoji: input.emoji || '⚡', targetTime: input.targetTime || '', proofMode: input.proofMode || 'photo' });
    const habit = {
      id: uid('habit'),
      ownerId: state.currentUserId,
      title: clean.title,
      emoji: clean.emoji,
      frequency: input.scheduleFrequency || input.frequency || 'daily',
      scheduleFrequency: input.scheduleFrequency || input.frequency || 'daily',
      scheduleWeekdays: input.scheduleWeekdays || [],
      targetQuantity: Number(input.targetQuantity ?? 1),
      targetUnit: input.targetUnit || 'count',
      targetTime: clean.targetTime,
      graceMinutes: Number(input.graceMinutes || 0),
      scheduleTimezone: input.scheduleTimezone || 'UTC',
      pauseWindows: [],
      proofMode: clean.proofMode,
      xp: Number(input.xp || 10),
      active: true,
    };
    state.habits.push(habit);
    emit();
    return clone(habit);
  }

  function ownedMemoryHabit(habitId) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (!habit || habit.ownerId !== state.currentUserId) throw new Error('You can only manage your own habit');
    return habit;
  }

  function updateHabit(habitId, input) {
    const habit = ownedMemoryHabit(habitId);
    const clean = validateHabitInput(input);
    habit.title = clean.title;
    habit.emoji = clean.emoji;
    habit.targetTime = clean.targetTime;
    habit.proofMode = clean.proofMode;
    habit.frequency = input.scheduleFrequency || input.frequency || habit.frequency || 'daily';
    habit.scheduleFrequency = habit.frequency;
    habit.scheduleWeekdays = input.scheduleWeekdays || habit.scheduleWeekdays || [];
    habit.targetQuantity = Number(input.targetQuantity ?? habit.targetQuantity ?? 1);
    habit.targetUnit = input.targetUnit || habit.targetUnit || 'count';
    habit.graceMinutes = Number(input.graceMinutes ?? habit.graceMinutes ?? 0);
    habit.scheduleTimezone = input.scheduleTimezone || habit.scheduleTimezone || 'UTC';
    emit();
    return clone(habit);
  }

  function pauseHabit(habitId, input) {
    const habit = ownedMemoryHabit(habitId);
    if (String(input.endDate) < String(input.startDate)) throw new Error('Pause end must be on or after start');
    habit.pauseWindows ||= [];
    habit.pauseWindows.push({ id: uid('pause'), startDate: String(input.startDate), endDate: String(input.endDate), reason: String(input.reason || '') });
    emit();
    return clone(habit);
  }

  function archiveHabit(habitId) {
    const habit = ownedMemoryHabit(habitId);
    habit.active = false;
    emit();
    return clone(habit);
  }

  function sendNudge(toUserId, message) {
    state.nudges ||= [];
    state.nudges.unshift({ id: uid('nudge'), fromUserId: state.currentUserId, toUserId, message, createdAt: new Date().toISOString() });
    emit();
  }

  function memberInCircle(userId, circleId = state.circleId) {
    return (state.members || []).some((member) => member.id === userId && member.active !== false && (!circleId || !member.circleId || member.circleId === circleId));
  }

  function sourceCompletion(sourceCheckInId) {
    const checkIn = (state.checkIns || []).find((item) => item.id === sourceCheckInId);
    const habit = (state.habits || []).find((item) => item.id === checkIn?.habitId);
    if (!checkIn || !habit || checkIn.userId !== state.currentUserId || checkIn.invalid === true || checkIn.valid === false) throw new Error('Choose one of your valid check-ins');
    if (state.circleId && habit.circleId && habit.circleId !== state.circleId) throw new Error('Check-in is outside the active squad');
    return checkIn;
  }

  function batonRecipient(recipientUserId, circleId = state.circleId) {
    const recipient = (state.members || []).find((member) => member.id === recipientUserId && member.id !== state.currentUserId);
    if (!recipient || !memberInCircle(recipientUserId, circleId)) throw new Error('Recipient must be another active circle member');
    if (recipient.batonOptedOut || recipient.baton_opted_out) throw new Error('Recipient opted out of baton passes');
    return recipient;
  }

  function startBaton(recipientUserId, sourceCheckInId, handedAt = new Date().toISOString()) {
    const source = sourceCompletion(sourceCheckInId);
    batonRecipient(recipientUserId);
    const expiry = new Date(new Date(handedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    if (state.baton?.active && new Date(state.baton.expiresAt).getTime() > new Date(handedAt).getTime()) throw new Error('That squad already has an active baton');
    state.baton = { id: uid('baton'), circleId: state.circleId, holderUserId: recipientUserId, sourceCheckInId: source.id, startedAt: handedAt, handedAt, expiresAt: expiry, active: true };
    state.batonHandoffs ||= [];
    state.batonHandoffs.push({ id: uid('handoff'), batonId: state.baton.id, circleId: state.circleId, fromUserId: state.currentUserId, toUserId: recipientUserId, sourceCheckInId: source.id, handedAt, expiresAt: expiry });
    emit();
    return clone(state.baton);
  }

  function passBaton(recipientUserId, sourceCheckInId, handedAt = new Date().toISOString()) {
    const baton = state.baton;
    const now = new Date(handedAt).getTime();
    if (!baton?.active || new Date(baton.expiresAt).getTime() <= now) {
      if (baton) baton.active = false;
      throw new Error('No active baton');
    }
    if (baton.holderUserId !== state.currentUserId) throw new Error('Only the current baton holder can pass it');
    const source = sourceCompletion(sourceCheckInId);
    batonRecipient(recipientUserId, baton.circleId);
    const expiry = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    baton.holderUserId = recipientUserId;
    baton.sourceCheckInId = source.id;
    baton.handedAt = handedAt;
    baton.expiresAt = expiry;
    state.batonHandoffs ||= [];
    state.batonHandoffs.push({ id: uid('handoff'), batonId: baton.id, circleId: baton.circleId, fromUserId: state.currentUserId, toUserId: recipientUserId, sourceCheckInId: source.id, handedAt, expiresAt: expiry });
    emit();
    return clone(baton);
  }

  function setBatonOptOut(enabled) {
    state.batonOptedOut = !Boolean(enabled);
    const member = state.members.find((item) => item.id === state.currentUserId);
    if (member) member.batonOptedOut = state.batonOptedOut;
    emit();
    return { userId: state.currentUserId, optedOut: state.batonOptedOut };
  }

  function addComment(checkInId, body) {
    sourceCompletion(checkInId);
    const comment = { id: uid('comment'), checkInId, circleId: state.circleId, authorId: state.currentUserId, body: validateCommentBody(body), createdAt: new Date().toISOString() };
    state.comments ||= [];
    state.comments.push(comment);
    emit();
    return clone(comment);
  }

  function deleteComment(commentId) {
    const index = (state.comments || []).findIndex((comment) => comment.id === commentId && comment.authorId === state.currentUserId);
    if (index < 0) throw new Error('You can only delete your own comment');
    const [deleted] = state.comments.splice(index, 1);
    emit();
    return clone(deleted);
  }

  function getEarnedBadges(options = {}) {
    const member = state.members.find((item) => item.id === state.currentUserId) || {};
    return computeEarnedBadges({ userId: state.currentUserId, members: state.members, habits: state.habits, checkIns: state.checkIns, batonHandoffs: state.batonHandoffs, asOfDate: options.asOfDate || new Date().toISOString().slice(0, 10), joinedDate: options.joinedDate || member.joinedDate, timeZone: options.timeZone || member.timeZone || 'UTC' });
  }

  function getMonthlyWrapped(month, options = {}) {
    return buildMonthlyWrapped({ month, circleId: state.circleId, members: state.members, habits: state.habits, checkIns: state.checkIns, reactions: state.reactions || [], comments: state.comments || [], batonHandoffs: state.batonHandoffs || [], nudges: state.nudges || [], asOfDate: options.asOfDate, timeZone: options.timeZone || 'UTC', recapEnabled: options.recapEnabled !== false, recapOptOut: Boolean(options.recapOptOut) });
  }

  return { getState, toggleHabit, completeWithProof, addHabit, updateHabit, pauseHabit, archiveHabit, sendNudge, startBaton, passBaton, setBatonOptOut, addComment, deleteComment, getEarnedBadges, getMonthlyWrapped };
}
