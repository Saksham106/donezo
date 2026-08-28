import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('Me habits open the existing bottom-sheet pattern for editing', () => {
  assert.match(app, /data-edit-habit/);
  assert.match(app, /editingHabitId/);
  assert.match(app, /function habitSheet\(\)/);
  assert.match(app, /Save changes/);
  assert.match(css, /\.habit-setting-button/);
});

test('edit sheet clearly separates save archive and cancel actions', () => {
  assert.match(app, /repo\.updateHabit\(/);
  assert.match(app, /repo\.archiveHabit\(/);
  assert.match(app, /Archive habit/);
  assert.match(app, /Cancel/);
  assert.match(app, /archiveConfirm/);
  assert.match(app, /Yes, archive it/);
});

test('habit management reuses mutation guard and closes after successful changes', () => {
  assert.match(app, /runMutation\(\(\) => repo\.updateHabit/);
  assert.match(app, /runMutation\(\(\) => repo\.archiveHabit/);
  assert.match(app, /editingHabitId = null/);
  assert.match(app, /habitSheetOpen = false/);
});
