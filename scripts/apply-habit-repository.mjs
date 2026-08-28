import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/store.js';
let source = await readFile(path, 'utf8');
if (source.includes('async function archiveHabit(habitId)')) {
  console.log('Habit repository changes already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) throw new Error(`${label}: source pattern not found`);
  source = source.replace(search, replacement);
}

replaceOnce(
`function appError(error, fallback) {
  const message = error?.message || fallback;
  return new Error(message);
}
`,
`function appError(error, fallback) {
  const message = error?.message || fallback;
  return new Error(message);
}

export function validateHabitInput(input = {}) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 80) throw new Error('Habit name must be 1–80 characters');
  const emoji = String(input.emoji || '').trim();
  if (!emoji || emoji.length > 16) throw new Error('Choose a valid emoji');
  const targetTime = input.targetTime == null ? '' : String(input.targetTime).trim();
  if (targetTime && !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(targetTime)) throw new Error('Enter a valid target time');
  const proofMode = String(input.proofMode || '');
  if (!['photo', 'none'].includes(proofMode)) throw new Error('Choose a valid proof mode');
  return { title, emoji, targetTime, proofMode };
}
`,
'validation helper',
);

replaceOnce(
"      client.from('habits').select('*').eq('circle_id', circle.id).eq('active', true).order('created_at'),",
"      client.from('habits').select('*').eq('circle_id', circle.id).order('created_at'),",
'load all habits',
);

const addPattern = /  async function addHabit\(input\) \{[\s\S]*?\n  \}\n\n  async function toggleHabit/;
const addMatch = source.match(addPattern);
if (!addMatch) throw new Error('addHabit block not found');
const replacement = `  async function addHabit(input) {
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
    const { error } = await client.from('habits').update({
      title: clean.title,
      emoji: clean.emoji,
      target_time: clean.targetTime || null,
      proof_mode: clean.proofMode,
      updated_at: new Date().toISOString(),
    }).eq('id', habitId).eq('owner_id', user.id);
    if (error) throw appError(error, 'Could not save habit');
    await load();
    return state.habits.find((habit) => habit.id === habitId);
  }

  async function archiveHabit(habitId) {
    ownedHabit(habitId);
    const { error } = await client.from('habits').update({
      active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', habitId).eq('owner_id', user.id);
    if (error) throw appError(error, 'Could not archive habit');
    await load();
    return state.habits.find((habit) => habit.id === habitId);
  }

  async function toggleHabit`;
source = source.replace(addPattern, replacement);

replaceOnce(
`    updateDisplayName,
    addHabit,
    toggleHabit,`,
`    updateDisplayName,
    addHabit,
    updateHabit,
    archiveHabit,
    toggleHabit,`,
'production exports',
);

replaceOnce(
`  function addHabit(input) {
    const habit = { id: uid('habit'), ownerId: state.currentUserId, title: input.title.trim(), emoji: input.emoji || '⚡', frequency: input.frequency || 'daily', targetTime: input.targetTime || '', proofMode: input.proofMode || 'photo', xp: Number(input.xp || 10), active: true };
    state.habits.push(habit);
    emit();
    return clone(habit);
  }

  function sendNudge`,
`  function addHabit(input) {
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

  function sendNudge`,
'memory lifecycle methods',
);

replaceOnce(
`  return { getState, toggleHabit, completeWithProof, addHabit, sendNudge };`,
`  return { getState, toggleHabit, completeWithProof, addHabit, updateHabit, archiveHabit, sendNudge };`,
'memory exports',
);

await writeFile(path, source);
