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

test('Squad uses a People sheet and truly separates activity from proofs', () => {
  const source = app.slice(app.indexOf('function squadScreen()'), app.indexOf('function challengeProgress'));
  assert.match(source, /data-people-open/);
  assert.match(source, /squad-feed-tabs/);
  assert.match(source, /data-squad-feed="activity"/);
  assert.match(source, /data-squad-feed="proofs"/);
  assert.match(source, /filter\(\(activity\) => !activity\.proofPath\)/);
  assert.doesNotMatch(source, /<div class="friends-list">/);
  assert.match(source, /aria-label="Refresh squad"/);
  assert.doesNotMatch(source, />Refresh<\/button>/);
  assert.match(app, /function peopleSheet\(\)/);
  assert.match(app, /data-invite-from-people/);
  assert.match(app, /people:/);
});

test('Baton is discoverable before the first check-in', () => {
  const source = app.slice(app.indexOf('function batonCard()'), app.indexOf('function squadScreen()'));
  assert.match(source, /data-baton-checkin/);
  assert.match(source, /data-invite-from-baton/);
  assert.doesNotMatch(source, /if \(!eligibleCheckIn \|\| !hasFriend\) return ''/);
});

test('League puts standings first and uses direct compact social actions', () => {
  const source = app.slice(app.indexOf('function leagueScreen()'), app.indexOf('function stakeHistory()'));
  assert.ok(source.indexOf('league-list') < source.indexOf('activeChallengeCard()'));
  assert.match(source, /data-challenge/);
  assert.match(source, /league-header-action/);
  assert.match(source, /league-tools/);
  assert.doesNotMatch(source, /league-more/);
  assert.doesNotMatch(source, /<details/);
  assert.doesNotMatch(source, /empty-challenge/);
});

test('mobile social stylesheet is complete and not accidentally swallowed by a malformed rule', () => {
  assert.doesNotMatch(social, /\[truncated\]/);
  assert.match(social, /\.activation-card\{[^}]*padding:/s);
  assert.match(social, /\.pwa-update-banner\{[^}]*position:fixed/s);
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
