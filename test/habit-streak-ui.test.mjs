import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../components.css', import.meta.url), 'utf8');

test('Today habit rows show a quiet numeric per-habit streak without a fire icon', () => {
  assert.match(app, /calculateHabitStreak/);
  assert.match(app, /habits\.map\(\(habit\) => habitCard\(habit, false, true\)\)/);
  assert.match(app, /class="habit-streak"[^>]*aria-label="\$\{streakLabel\}"[^>]*>\$\{streak\.count\}<\/span>/);
  assert.doesNotMatch(app.slice(app.indexOf('function habitCard'), app.indexOf('function todayScreen')), /🔥/);
  assert.match(css, /\.habit-streak\{/);
});