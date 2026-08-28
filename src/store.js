import {
  calculateBestStreak,
  calculateStreak,
  localDateInTimeZone,
  rejectedCheckInIds,
} from './domain.js';

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
  const memberRows = rows.members?.length
    ? rows.members
    : [{ user_id: user.id, profiles: profile }];
  const memberProfileById = new Map(memberRows.map((membership) => {
    const memberProfile = membership.profiles || {};
    return [membership.user_id || memberProfile.id, memberProfile];
  }));

  const habits = (rows.habits || []).map((habit) => {
    const ownerProfile = memberProfileById.get(habit.owner_id) || {};
    const ownerTimeZone = ownerProfile.timezone || 'UTC';
    return {
      id: habit.id,
      circleId: habit.circle_id,
      ownerId: habit.owner_id,
      title: habit.title,
      emoji: habit.emoji,
      frequency: habit.frequency,
      targetTime: habit.target_time?.slice(0, 5) || '',
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
      proofPath: checkIn.proof_path,
      note: checkIn.note,
    }));
  const reactions = (rows.reactions || []).map((reaction) => ({
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
      xp,
      currentStreak: calculateStreak(dates, today),
      bestStreak: calculateBestStreak(dates),
    };
  });
  const memberById = new Map(members.map((member) => [member.id, member]));
  const friendActivities = checkIns
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, 40)
    .map((checkIn) => {
      const habit = habitById.get(checkIn.habitId);
      const actor = memberById.get(checkIn.userId);
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
      };
    });

  return {
    currentUserId: user.id,
    circleId: rows.circle?.id || null,
    circleName: rows.circle?.name || null,
    circleInviteCode: rows.circle?.invite_code || null,
    members,
    habits,
    checkIns,
    reactions,
    friendActivities,
    nudges: (rows.nudges || []).map((nudge) => ({
      id: nudge.id,
      circleId: nudge.circle_id,
      fromUserId: nudge.from_user_id,
      toUserId: nudge.to_user_id,
      message: nudge.message,
      createdAt: nudge.created_at,
      readAt: nudge.read_at,
    })),
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

  async function load() {
    const profile = await ensureProfile();
    const { data: membership, error: membershipError } = await client
      .from('circle_members')
      .select('circle_id, role, circles!circle_members_circle_id_fkey(id,name,invite_code,owner_id)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw appError(membershipError, 'Could not load your circle');
    const circle = membership?.circles || null;
    if (!circle) {
      state = mapDatabaseState(user, { profile, circle: null, members: [], habits: [], checkIns: [], reactions: [], nudges: [] });
      return getState();
    }

    const [membersResult, habitsResult, nudgesResult] = await Promise.all([
      client.from('circle_members')
        .select('user_id, role, profiles!circle_members_user_id_fkey(id,username,display_name,avatar_url,timezone)')
        .eq('circle_id', circle.id)
        .order('joined_at', { ascending: true }),
      client.from('habits').select('*').eq('circle_id', circle.id).order('created_at'),
      client.from('nudges').select('*').eq('circle_id', circle.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const failed = [membersResult, habitsResult, nudgesResult].find((result) => result.error);
    if (failed) throw appError(failed.error, 'Could not load Donezo data');
    const habitIds = habitsResult.data.map((habit) => habit.id);
    const checkInsResult = habitIds.length
      ? await client.from('check_ins').select('*').in('habit_id', habitIds).order('completed_at', { ascending: false }).limit(1000)
      : { data: [], error: null };
    if (checkInsResult.error) throw appError(checkInsResult.error, 'Could not load Donezo data');
    const checkInIds = checkInsResult.data.map((checkIn) => checkIn.id);
    const reactionsResult = checkInIds.length
      ? await client.from('reactions').select('*').in('check_in_id', checkInIds).order('created_at')
      : { data: [], error: null };
    if (reactionsResult.error) throw appError(reactionsResult.error, 'Could not load proof votes');
    state = mapDatabaseState(user, {
      profile,
      circle,
      members: membersResult.data,
      habits: habitsResult.data,
      checkIns: checkInsResult.data,
      reactions: reactionsResult.data,
      nudges: nudgesResult.data,
    });
    return getState();
  }

  function getState() {
    return clone(state);
  }

  async function createCircle(name) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 60) throw new Error('Circle name must be 1–60 characters');
    const { error } = await client.from('circles').insert({ name: cleanName, owner_id: user.id });
    if (error) throw appError(error, 'Could not create circle');
    return load();
  }

  async function joinCircle(inviteCode) {
    const code = inviteCode.trim().toLowerCase();
    if (!/^[a-z0-9]{12}$/.test(code)) throw new Error('Enter the 12-character invite code');
    const { error } = await client.rpc('join_circle', { supplied_code: code });
    if (error) throw appError(error, 'Invalid or expired invite code');
    return load();
  }

  async function updateDisplayName(displayName) {
    const cleanName = displayName.trim();
    if (!cleanName || cleanName.length > 60) throw new Error('Name must be 1–60 characters');
    const { error } = await client.from('profiles').update({ display_name: cleanName }).eq('id', user.id);
    if (error) throw appError(error, 'Could not update your name');
    return load();
  }

  async function addHabit(input) {
    if (!state.circleId) throw new Error('Create or join a circle first');
    const clean = validateHabitInput({
      title: input.title,
      emoji: input.emoji || '⚡',
      targetTime: input.targetTime || '',
      proofMode: input.proofMode || 'photo',
    });
    const payload = {
      circle_id: state.circleId,
      owner_id: user.id,
      title: clean.title,
      emoji: clean.emoji,
      frequency: input.frequency || 'daily',
      target_time: clean.targetTime || null,
      proof_mode: clean.proofMode,
    };
    const { error } = await client.from('habits').insert(payload);
    if (error) throw appError(error, 'Could not add habit');
    await load();
    return state.habits.find((habit) => habit.ownerId === user.id && habit.title === clean.title);
  }

  function ownedHabit(habitId) {
    const habit = state.habits.find((item) => item.id === habitId);
    if (!habit || habit.ownerId !== user.id || habit.circleId !== state.circleId) {
      throw new Error('You can only manage your own habit');
    }
    return habit;
  }

  async function updateHabit(habitId, input) {
    ownedHabit(habitId);
    const clean = validateHabitInput(input);
    const { data: updated, error } = await client.from('habits').update({
      title: clean.title,
      emoji: clean.emoji,
      target_time: clean.targetTime || null,
      proof_mode: clean.proofMode,
      updated_at: new Date().toISOString(),
    }).eq('id', habitId).eq('owner_id', user.id).select('*').maybeSingle();
    if (error) throw appError(error, 'Could not save habit');
    if (!updated) throw new Error('Habit could not be updated. Refresh and try again.');
    await load();
    return state.habits.find((habit) => habit.id === habitId);
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

  async function toggleHabit(habitId, date) {
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
      const { error } = await client.from('check_ins').insert({ habit_id: habitId, user_id: user.id, check_date: date });
      if (error) throw appError(error, 'Could not complete habit');
    }
    return load();
  }

  async function completeWithProof(habitId, date, file) {
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

  async function sendNudge(toUserId, message) {
    if (!state.circleId) throw new Error('Create or join a circle first');
    const cleanMessage = message.trim();
    if (!cleanMessage || cleanMessage.length > 140) throw new Error('Nudge must be 1–140 characters');
    const { data, error } = await client.from('nudges').insert({
      circle_id: state.circleId,
      from_user_id: user.id,
      to_user_id: toUserId,
      message: cleanMessage,
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
    createCircle,
    joinCircle,
    updateDisplayName,
    addHabit,
    updateHabit,
    archiveHabit,
    toggleHabit,
    completeWithProof,
    toggleDownvote,
    sendNudge,
    markNudgeRead,
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
      state.checkIns.unshift({ id: uid('checkin'), habitId, userId: state.currentUserId, date, completedAt: new Date().toISOString(), proofUrl: proofUrl || null });
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
    const habit = { id: uid('habit'), ownerId: state.currentUserId, title: clean.title, emoji: clean.emoji, frequency: input.frequency || 'daily', targetTime: clean.targetTime, proofMode: clean.proofMode, xp: Number(input.xp || 10), active: true };
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
    state.nudges.unshift({ id: uid('nudge'), fromUserId: state.currentUserId, toUserId, message, createdAt: new Date().toISOString() });
    emit();
  }

  return { getState, toggleHabit, completeWithProof, addHabit, updateHabit, archiveHabit, sendNudge };
}
