import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('habit editor offers a dedicated flexible weekly schedule with a 1–7 day target', () => {
  assert.match(app, /option value="times_per_week"[^>]*>X times per week<\/option>/);
  assert.match(app, /name="weeklyTargetDays"/);
  for (let day = 1; day <= 7; day += 1) {
    assert.match(app, new RegExp(`<option value="${day}"`));
  }
  assert.match(app, /Any distinct days count Monday–Sunday/);
  assert.match(app, /data-weekly-target/);
  assert.match(app, /data-schedule-weekdays/);
});

test('habit form persists weeklyTargetDays and schedule helpers carry it into evaluation', () => {
  assert.match(app, /weeklyTargetDays:\s*Number\(form\.get\('weeklyTargetDays'\)\s*\|\|\s*1\)/);
  assert.match(app, /weeklyTargetDays:\s*habit\.weeklyTargetDays\s*\?\?\s*1/);
});

test('schedule selection toggles weekly and weekday controls without rerendering the form', () => {
  assert.match(app, /function syncHabitScheduleFields\(/);
  assert.match(app, /\[name="scheduleFrequency"\][\s\S]{0,500}syncHabitScheduleFields/);
  assert.match(app, /weeklyTarget\.hidden\s*=\s*frequency\s*!==\s*'times_per_week'/);
  assert.match(app, /weekdays\.hidden\s*=\s*!\['selected_weekdays',\s*'weekly'\]\.includes\(frequency\)/);
});

test('flexible weekly habits render weekly progress instead of an arbitrary daily due state', () => {
  assert.match(app, /function flexibleWeekProgress\(/);
  assert.match(app, /weeklyCompletionScore\(/);
  assert.match(app, /of \$\{weekly\.possible\} this week/);
  assert.match(app, /Goal starts next Monday/);
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
