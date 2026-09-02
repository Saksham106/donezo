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

test('edit sheet separates save archive and cancel, with reversible archive', () => {
  assert.match(app, /repo\.updateHabit\(/);
  assert.match(app, /repo\.archiveHabit\(/);
  assert.match(app, /Archive habit/);
  assert.match(app, /Cancel/);
  assert.match(app, /handleUndoArchive/);
  assert.match(app, /label:\s*'Undo'/);
});

test('habit management reuses mutation guard and closes after successful changes', () => {
  assert.match(app, /runMutation\(\(\) => repo\.updateHabit/);
  assert.match(app, /runMutation\(\(\) => repo\.archiveHabit/);
  assert.match(app, /editingHabitId = null/);
  assert.match(app, /habitSheetOpen = false/);
});

test('emoji selection does not rerender and wipe unsaved habit fields', () => {
  assert.match(app, /selectedEmoji = element\.dataset\.emoji;[\s\S]{0,240}classList\.toggle/);
  assert.doesNotMatch(app, /selectedEmoji = element\.dataset\.emoji;\s*render\(\)/);
});

test('background refresh keeps unsaved drafts and a scrolled Friends feed mounted', () => {
  assert.match(app, /function hasUnsavedDraft\(\)/);
  assert.match(app, /Boolean\(dualProof\)/);
  assert.match(app, /function shouldDeferFriendsRefreshRender\(\)/);
  assert.match(app, /lastRefreshAt = new Date\(\)\.toISOString\(\);\s*if \(!hasUnsavedDraft\(\) && !shouldDeferFriendsRefreshRender\(\)\) renderPreservingScroll\(\);/);
  assert.match(app, /onNetworkChange:\s*\(value\) => \{[\s\S]{0,240}if \(!hasUnsavedDraft\(\) && !shouldDeferFriendsRefreshRender\(\)\) renderPreservingScroll\(\);/);
});
