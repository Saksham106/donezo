import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('Me habits open the existing bottom-sheet pattern for editing', () => {
  assert.match(app, /data-edit-habit/);
  assert.match(app, /editingHabitId/);
  assert.match(app, /function habitSheet\(\)/);
  assert.match(app, /Save changes/);
  assert.match(css, /\.habit-setting-button/);
});
