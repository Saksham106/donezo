import { calculateBestStreak, calculateStreak } from './domain.js';

const clone = (value) => structuredClone(value);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function appError(error, fallback) {
  const message = error?.message || fallback;
  return new Error(message);
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function mapDatabaseState(user, rows) {
  const profile = rows.profile || {
    id: user.id,
    display_name: user.email?.split('@')[0] || 'You',
    username: null,
    avatar_url: null,
  };
  const habits = (rows.habits || []).map((habit) => ({
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
  }));
  const habitById = new Map(habits.map((habit) => [habit.id, habit]));
  const checkIns = (rows.checkIns || [])
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
  const today = rows.today || dateInTimezone(profile.timezone);
  const memberRows = rows.members?.length
    ? rows.members
    : [{ user_id: user.id, profiles: profile }];
  const members = memberRows.map((membership) => {
    const memberProfile = membership.profiles || {};
    const memberId = membership.user_id || memberProfile.id;
    const dates = [...new Set(checkIns.filter((checkIn) => checkIn.userId === memberId).map((checkIn) => checkIn.date))];
    const xp = checkIns
      .filter((checkIn) => checkIn.userId === memberId)
      .reduce((total, checkIn) => total + (habitById.get(checkIn.habitId)?.xp || 0), 0);
    const name = memberProfile.display_name || memberProfile.username || 'Friend';
    return {
      id: memberId,
      name,
      handle: memberProfile.username ? `@${memberProfile.username}` : '',
      avatar: initials(name),
      avatarUrl: memberProfile.avatar_url,
      xp,
      currentStreak: calculateStreak(dates, today),
      bestStreak: calculateBestStreak(dates),
    };
  });
  const memberById = new Map(members.map((member) => [member.id, member]));
  const friendActivities = checkIns
    .filter((checkIn) => checkIn.userId !== user.id)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, 30)
    .map((checkIn) => {
      const habit = habitById.get(checkIn.habitId);
      const actor = memberById.get(checkIn.userId);
      return {
        id: checkIn.id,
        userId: checkIn.userId,
        type: 'completed',
        habitTitle: habit?.title || 'Habit',
        emoji: habit?.emoji || '⚡',
        when: checkIn.completedAt,
        streak: actor?.currentStreak || 0,
        message: checkIn.note || 'Done. Proof beats promises.',
        proofPath: checkIn.proofPath,
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
      state = mapDatabaseState(user, { profile, circle: null, members: [], habits: [], checkIns: [], nudges: [] });
      return getState();
    }

    const [membersResult, habitsResult, nudgesResult] = await Promise.all([
      client.from('circle_members')
        .select('user_id, role, profiles!circle_members_user_id_fkey(id,username,display_name,avatar_url)')
        .eq('circle_id', circle.id)
        .order('joined_at', { ascending: true }),
      client.from('habits').select('*').eq('circle_id', circle.id).eq('active', true).order('created_at'),
      client.from('nudges').select('*').eq('circle_id', circle.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const failed = [membersResult, habitsResult, nudgesResult].find((result) => result.error);
    if (failed) throw appError(failed.error, 'Could not load Donezo data');
    const habitIds = habitsResult.data.map((habit) => habit.id);
    const checkInsResult = habitIds.length
      ? await client.from('check_ins').select('*').in('habit_id', habitIds).order('completed_at', { ascending: false }).limit(1000)
      : { data: [], error: null };
    if (checkInsResult.error) throw appError(checkInsResult.error, 'Could not load Donezo data');
    state = mapDatabaseState(user, {
      profile,
      circle,
      members: membersResult.data,
      habits: habitsResult.data,
      checkIns: checkInsResult.data,
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

  async function addHabit(input) {
    if (!state.circleId) throw new Error('Create or join a circle first');
    const title = input.title.trim();
    if (!title || title.length > 80) throw new Error('Habit name must be 1–80 characters');
    const payload = {
      circle_id: state.circleId,
      owner_id: user.id,
      title,
      emoji: input.emoji || '⚡',
      frequency: input.frequency || 'daily',
      target_time: input.targetTime || null,
      proof_mode: input.proofMode || 'none',
    };
    const { error } = await client.from('habits').insert(payload);
    if (error) throw appError(error, 'Could not add habit');
    await load();
    return state.habits.find((habit) => habit.ownerId === user.id && habit.title === title);
  }

  async function toggleHabit(habitId, date) {
    const existing = state.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === user.id && checkIn.date === date);
    if (existing) {
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
      const { error } = await client.from('check_ins').insert({ habit_id: habitId, user_id: user.id, check_date: date });
      if (error) throw appError(error, 'Could not complete habit');
    }
    return load();
  }

  async function completeWithProof(habitId, date, file) {
    const path = proofObjectPath(user.id, habitId, file.type);
    const { error: uploadError } = await client.storage.from('proofs').upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw appError(uploadError, 'Could not upload proof');
    const { error: checkInError } = await client.from('check_ins').insert({
      habit_id: habitId,
      user_id: user.id,
      check_date: date,
      proof_path: path,
    });
    if (checkInError) {
      const { error: cleanupError } = await client.storage.from('proofs').remove([path]);
      if (cleanupError) {
        throw new Error(`${checkInError.message || 'Could not save check-in'}; uploaded proof cleanup also failed`);
      }
      throw appError(checkInError, 'Could not save check-in');
    }
    return load();
  }

  async function sendNudge(toUserId, message) {
    if (!state.circleId) throw new Error('Create or join a circle first');
    const cleanMessage = message.trim();
    if (!cleanMessage || cleanMessage.length > 140) throw new Error('Nudge must be 1–140 characters');
    const { error } = await client.from('nudges').insert({
      circle_id: state.circleId,
      from_user_id: user.id,
      to_user_id: toUserId,
      message: cleanMessage,
    });
    if (error) throw appError(error, 'Could not send nudge');
    return load();
  }

  async function getProofUrl(path) {
    const { data, error } = await client.storage.from('proofs').createSignedUrl(path, 300);
    if (error) throw appError(error, 'Could not open proof');
    return data.signedUrl;
  }

  return { getState, load, createCircle, joinCircle, addHabit, toggleHabit, completeWithProof, sendNudge, getProofUrl };
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
    const habit = { id: uid('habit'), ownerId: state.currentUserId, title: input.title.trim(), emoji: input.emoji || '⚡', frequency: input.frequency || 'daily', targetTime: input.targetTime || '', proofMode: input.proofMode || 'none', xp: Number(input.xp || 10), active: true };
    state.habits.push(habit);
    emit();
    return clone(habit);
  }

  function sendNudge(toUserId, message) {
    state.nudges.unshift({ id: uid('nudge'), fromUserId: state.currentUserId, toUserId, message, createdAt: new Date().toISOString() });
    emit();
  }

  return { getState, toggleHabit, completeWithProof, addHabit, sendNudge };
}
