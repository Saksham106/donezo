import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('habit editor offers a dedicated flexible weekly schedule with a 1–7 day target', () => {
  assert.match(app, /option value="times_per_week"[^>]*>X times per week<\/option>/);
  assert.match(app, /name="weeklyTargetDays"/);
  assert.match(app, /\[1, 2, 3, 4, 5, 6, 7\]\.map/);
  assert.match(app, /<option value="\$\{day\}"/);
  assert.match(app, /Any distinct days count Monday–Sunday/);
  assert.match(app, /data-weekly-target/);
  assert.match(app, /data-schedule-weekdays/);
});

test('travel pause uses an app-style disclosure instead of native details summary', () => {
  assert.doesNotMatch(app, /class="schedule-pause"><summary>Pause for travel or a break<\/summary>/);
  assert.match(app, /data-toggle-habit-pause/);
  assert.match(app, /aria-expanded="false"/);
  assert.match(app, /data-habit-pause-panel/);
  assert.match(app, /pause-chevron/);
  assert.match(app, /<svg[^>]*viewBox="0 0 24 24"/);
});

test('pause date fields are constrained inside their card and stack only on very narrow screens', () => {
  assert.match(css, /\.pause-date-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)[^}]*min-width:0/);
  assert.match(css, /\.pause-date-grid>label\{[^}]*min-width:0/);
  assert.match(css, /\.pause-date-grid input\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0/);
  assert.match(css, /@media\(max-width:340px\)\{[^}]*\.pause-date-grid\{grid-template-columns:1fr\}/);
});
