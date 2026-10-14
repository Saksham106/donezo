import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('nudge composer is a foreground layer above the People flow', () => {
  assert.match(app, /nudge-composer-layer/);
  assert.match(css, /\.nudge-composer-layer\{[^}]*z-index:\s*(?:9\d|1\d\d)/);
});

test('center Check In is a direct action, not a duplicate primary screen', () => {
  assert.match(app, /data-checkin-action/);
  assert.doesNotMatch(app, /const PRIMARY_TABS = \[[^\]]*'checkin'/);
  const screens = app.match(/const screens = \{[^}]+\}/)?.[0] || '';
  assert.doesNotMatch(screens, /checkin:/);
});

test('Me uses friends language', () => {
  assert.match(app, /<small>friends<\/small>/);
  assert.doesNotMatch(app, /<small>people<\/small>/);
});

test('new proof rejection requires a confirmation sheet', () => {
  assert.match(app, /function proofRejectSheet\(\)/);
  assert.match(app, /Reject this proof\?/);
  assert.match(app, /data-confirm-reject/);
  assert.match(app, /data-request-reject/);
});

test('service worker cache is stamped for each shell build', () => {
  assert.match(sw, /donezo-shell-__BUILD_ID__/);
});
