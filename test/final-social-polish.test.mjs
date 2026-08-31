import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('nudge composer is a foreground layer above the People flow', () => {
  assert.match(app, /nudge-composer-layer/);
  assert.match(css, /\.nudge-composer-layer\{[^}]*z-index:\s*(?:9\d|1\d\d)/);
});

test('Squad is stripped back and Baton lives in League actions', () => {
  const squad = app.slice(app.indexOf('function squadScreen()'), app.indexOf('function challengeProgress'));
  const leagueActions = app.slice(app.indexOf('function challengeInfoSheet()'), app.indexOf('function stakeHistory()'));
  assert.doesNotMatch(squad, /See what happened|Hype your people|\$\{batonCard\(\)\}/);
  assert.match(leagueActions, /LEAGUE ACTIONS/);
  assert.match(leagueActions, /\$\{batonCard\(\)\}/);
  assert.match(app, /challengeInfoOpen\s*=\s*false;\s*batonSheetOpen\s*=\s*true/);
});

test('theme choice supports system, light, and dark without startup flash', () => {
  assert.match(html, /donezo\.theme/);
  assert.match(app, /data-theme-choice="system"/);
  assert.match(app, /data-theme-choice="light"/);
  assert.match(app, /data-theme-choice="dark"/);
  assert.match(app, /localStorage\.setItem\(THEME_KEY/);
  assert.match(tokens, /\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/);
  assert.doesNotMatch(styles, /html,body\{[^}]*color-scheme:\s*light dark/);
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

test('service worker cache advances for this shell release', () => {
  assert.match(sw, /donezo-shell-v21/);
});
