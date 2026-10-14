import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { calculateHabitStreak } from '../src/domain.js';

const profile = await readFile(new URL('../src/ui/profile.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../components.css', import.meta.url), 'utf8');
const from = profile.indexOf('function habitRow(');
const to = profile.indexOf('\n}\n', from);
assert.ok(from >= 0 && to > from, 'Profile renders habit rows');
const rowSource = profile.slice(from, to + 3);

const habit = { id: 'habit-1', ownerId: 'me', title: 'Read', emoji: '📚', active: true, createdAt: '2026-10-01T12:00:00Z', scheduleFrequency: 'daily', targetQuantity: 1, proofMode: 'photo' };
const state = { currentUserId: 'me', checkIns: ['2026-10-11', '2026-10-12'].map((date) => ({ habitId: habit.id, userId: 'me', date, completedQuantity: 1 })) };

const habitRow = runInNewContext(`${rowSource}\nhabitRow`, {
  calculateHabitStreak, getState: () => state, today: () => '2026-10-13',
  habitPausedOn: () => false, scheduleLabel: () => 'Daily',
  esc: (value) => String(value), icon: () => '',
});

test('Profile habit rows retain a quiet numeric per-habit streak without a fire icon', () => {
  const html = habitRow(habit);
  assert.match(html, /class="habit-streak"[^>]*aria-label="2 check-in streak"[^>]*>2<\/span>/);
  assert.doesNotMatch(html, /🔥/);
  assert.match(css, /\.habit-streak\{/);
});

test('Profile habit streak ignores rejected check-ins', () => {
  const previous = state.checkIns;
  state.checkIns = previous.map((item) => ({ ...item, invalid: true }));
  try {
    assert.match(habitRow(habit), /aria-label="0 check-in streak"[^>]*>0<\/span>/);
  } finally {
    state.checkIns = previous;
  }
});
