import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { missedHabits, myHabits } from '../src/today-domain.js';

const source = readFileSync(new URL('../src/ui/profile.js', import.meta.url), 'utf8');
const bindSource = source.slice(source.indexOf('export function bindProfile(')).replace('export function', 'function');
const day = '2026-10-13';
const yesterday = '2026-10-12';
const habit = (id, extra = {}) => ({ id, title: id, active: true, ownerId: 'me', scheduleFrequency: 'daily', createdDate: '2026-10-01', ...extra });

function clickMissed(state, selectedDate = yesterday) {
  const element = { dataset: { stripMissed: selectedDate } };
  const calls = [];
  const root = { querySelectorAll: (selector) => selector === '[data-strip-missed]' ? [element] : [] };
  const bind = runInNewContext(`${bindSource}\nbindProfile`, {
    ui: {}, getState: () => state, today: () => day, missedHabits, myHabits,
    openRecovery: (...args) => calls.push(args), bindWrappedSwipe: () => {}, bindProofThumbnails: () => {},
  });
  bind(root);
  element.onclick();
  return calls;
}

test('Profile bounce-back selects the scheduled miss, not an off-day habit', () => {
  const state = { currentUserId: 'me', habits: [habit('off', { scheduleFrequency: 'selected_weekdays', scheduleWeekdays: [2] }), habit('miss')], checkIns: [], recoveries: [] };
  assert.deepEqual(clickMissed(state), [['miss', yesterday]]);
});

test('Profile bounce-back skips paused, future and recovered habits', () => {
  const state = { currentUserId: 'me', habits: [habit('paused', { pauseWindows: [{ startDate: yesterday, endDate: day }] }), habit('future', { createdDate: day }), habit('recovered'), habit('miss')], checkIns: [], recoveries: [{ habitId: 'recovered', missedDate: yesterday }] };
  assert.deepEqual(clickMissed(state), [['miss', yesterday]]);
});

test('Profile bounce-back does not act on a stale strip date', () => {
  const state = { currentUserId: 'me', habits: [habit('miss')], checkIns: [], recoveries: [] };
  assert.deepEqual(clickMissed(state, '2026-10-11'), []);
});
