import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const invite = await readFile(new URL('../src/invite.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

const slice = (name, next) => app.slice(app.indexOf(`function ${name}`), app.indexOf(`function ${next}`));

test('daily schedule keeps exact-day controls out of the way and weekday edits switch to specific days', () => {
  const source = slice('habitSheet', 'settingsSheet');
  assert.match(source, /data-schedule-weekdays/);
  assert.match(source, /\['selected_weekdays', 'weekly'\]\.includes\(scheduleFrequency\)/);
  assert.match(app, /scheduleSelect\?\.addEventListener\('change'/);
  assert.match(app, /scheduleSelect\.value === 'daily'[\s\S]*checkbox\.checked = true/);
  assert.match(app, /checkbox\.checked && scheduleSelect[\s\S]*scheduleSelect\.value = 'selected_weekdays'/);
});

test('pause dates are bounded and overlapping or reversed pauses are rejected in the UI', () => {
  assert.match(app, /startDate.*endDate.*overlap|overlap.*startDate.*endDate/s);
  assert.match(app, /startDate > endDate|startDate\.localeCompare\(endDate\)/);
  assert.match(social, /\.pause-date-grid\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(social, /\.pause-date-grid input\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0/);
  assert.match(social, /\.pause-disclosure/);
});

test('friend nudges are private and do not expose unrelated friend networks', () => {
  const composer = slice('nudgeComposerSheet', 'nudgeInboxSheet');
  assert.match(composer, /Only .* sees it\./s);
  assert.doesNotMatch(composer, /Public callout|whole squad|name="visibility"/i);
});
