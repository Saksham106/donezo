import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contextualHabitStatus, groupSquadActivity } from '../src/ux.js';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const components = await readFile(new URL('../components.css', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');

const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

test('schedule edit guard includes timezone changes after today check-in', () => {
  const submit = slice('async function handleHabitSubmit', 'async function handlePauseSubmit');
  assert.match(submit, /input\.scheduleTimezone\s*!==\s*\(existing\.scheduleTimezone/);
});

test('contextual habit language handles completed and upcoming commitments', () => {
  assert.match(contextualHabitStatus({ completedAt: '2026-08-30T10:00:00Z' }, { now: '2026-08-30T10:03:00Z' }), /Done 3m ago/);
  assert.equal(contextualHabitStatus({ completedAt: 'not-a-date' }), 'Done');
  assert.match(contextualHabitStatus({ targetTime: '12:00' }, { now: '2026-08-30T10:00:00', date: '2026-08-30' }), /Due in 2h/);
  assert.equal(
    contextualHabitStatus(
      { targetTime: '12:00', scheduleTimezone: 'UTC' },
      { now: '2026-08-30T12:00:00Z', date: '2026-08-30' },
    ),
    'Due now',
  );
  assert.equal(
    contextualHabitStatus(
      { targetTime: '12:00', scheduleTimezone: 'America/New_York' },
      { now: '2026-08-30T16:00:00Z', date: '2026-08-30' },
    ),
    'Due now',
  );
  assert.match(contextualHabitStatus({ targetTime: '9:00' }, { now: '2026-08-30T08:00:00', date: '2026-08-30' }), /Due in 60m/);
});

test('sheet close handlers do not reference removed archive-confirm state', () => {
  assert.doesNotMatch(app, /archiveConfirm/);
  assert.match(app, /function closeSheets\(\)[\s\S]*settingsSheetOpen = false/);
});

test('baton preference uses one enabled-state contract in the app and both repositories', () => {
  assert.match(app, /repo\.setBatonEnabled\(batonEnabled\)/);
  assert.doesNotMatch(app, /setBatonOptOut/);
  assert.equal((store.match(/function setBatonEnabled\(enabled\)/g) || []).length, 2);
  assert.match(store, /set_baton_opt_out', \{ enabled: Boolean\(enabled\) \}/);
  assert.match(store, /state\.batonOptedOut = !Boolean\(enabled\)/);
});
