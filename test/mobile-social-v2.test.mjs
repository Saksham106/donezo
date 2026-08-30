import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('Today is reduced to one progress summary and the habit list', () => {
  const source = app.slice(app.indexOf('function todayScreen()'), app.indexOf('function checkInScreen()'));
  assert.match(source, /today-progress/);
  assert.match(source, /habit-list/);
  assert.doesNotMatch(source, /metric-strip/);
  assert.doesNotMatch(source, /next-up/);
  assert.doesNotMatch(source, /rankMembersByWeeklyScore/);
});

test('Squad uses a People sheet and separates activity from proofs', () => {
  const source = app.slice(app.indexOf('function squadScreen()'), app.indexOf('function challengeProgress'));
  assert.match(source, /data-people-open/);
  assert.match(source, /squad-feed-tabs/);
  assert.match(source, /data-squad-feed="activity"/);
  assert.match(source, /data-squad-feed="proofs"/);
  assert.doesNotMatch(source, /<div class="friends-list">/);
  assert.match(app, /function peopleSheet\(\)/);
  assert.match(app, /data-invite-from-people/);
  assert.match(app, /people:/);
});

test('League puts standings before optional social extras and challenge creation is compact', () => {
  const source = app.slice(app.indexOf('function leagueScreen()'), app.indexOf('function stakeHistory()'));
  assert.ok(source.indexOf('league-list') < source.indexOf('activeChallengeCard()'));
  assert.match(source, /data-challenge/);
  assert.match(source, /league-header-action/);
  assert.doesNotMatch(source, /empty-challenge/);
});

test('mobile controls have robust touch targets and a thicker bottom bar anchored to the bottom', () => {
  assert.match(styles, /\.nav\{[^}]*padding:\.3rem[^}]*var\(--app-safe-bottom\)/s);
  assert.match(styles, /\.nav-btn\{[^}]*min-height:\s*3\.35rem/s);
  assert.match(styles, /\.nav-icon\{[^}]*width:\s*1\.3rem/s);
  assert.match(styles, /\.app-shell\{[^}]*inset:\s*0/s);
  assert.match(social, /\.people-sheet/);
  assert.match(social, /\.squad-feed-tabs/);
  assert.match(social, /\.people-row/);
});
