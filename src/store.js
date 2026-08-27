const clone = (value) => structuredClone(value);
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createMemoryRepository(seed, onChange = () => {}) {
  const state = clone(seed);
  const emit = () => onChange(clone(state));
  function getState() { return clone(state); }

  function toggleHabit(habitId, date, proofUrl) {
    const existingIndex = state.checkIns.findIndex((c) => c.habitId === habitId && c.userId === state.currentUserId && c.date === date);
    const habit = state.habits.find((h) => h.id === habitId);
    const member = state.members.find((m) => m.id === state.currentUserId);
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
    const already = state.checkIns.some((c) => c.habitId === habitId && c.userId === state.currentUserId && c.date === date);
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

export function createLocalRepository(seed, storageKey = 'donezo-mvp-state') {
  let initial = seed;
  try { const saved = localStorage.getItem(storageKey); if (saved) initial = JSON.parse(saved); } catch {}
  return createMemoryRepository(initial, (state) => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {} });
}
