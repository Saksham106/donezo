import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

const slice = (name, next) => app.slice(app.indexOf(`function ${name}`), app.indexOf(`function ${next}`));

test('primary navigation and topbar speak in Friends, not squad switching', () => {
  assert.match(app, /const PRIMARY_TABS = \['today', 'friends', 'league', 'me'\]/);
  assert.match(app, /item\('friends', 'people', 'Friends'\)/);
  assert.match(app, /data-friends/);
  assert.doesNotMatch(app.slice(app.indexOf('function topbar()'), app.indexOf('function offlineIndicator')), /Switch squad/);
  assert.doesNotMatch(app.slice(app.indexOf('function topbar()'), app.indexOf('function offlineIndicator')), /squad-switcher/);
});

test('Friends renders one authorized proof feed with heading actions on the same row', () => {
  const source = slice('friendsScreen', 'challengeProgress');
  assert.match(source, /friends-heading-row/);
  assert.match(source, /data-people-open/);
  assert.match(source, /data-manual-refresh/);
  assert.match(source, /activityList\(state\)/);
  assert.match(source, /filter\(\(activity\) => activity\.proofPath/);
  assert.doesNotMatch(source, /data-squad-feed/);
  assert.doesNotMatch(source, /Hype your people|See what happened/);
});

test('Friends and League prefer new state while preserving member fallbacks', () => {
  assert.match(app, /function friendList\(state = getState\(\)\)/);
  assert.match(app, /state\?\.friends/);
  assert.match(app, /state\??\.members/);
  const league = slice('leagueScreen', 'challengeInfoSheet');
  assert.match(league, /Your League/);
  assert.match(league, /leagueMembers\(state\)/);
});

test('habit sheet exposes all-friends, selected-friends, and only-me audience controls', () => {
  const source = slice('habitSheet', 'settingsSheet');
  assert.match(source, /name="audienceMode"/);
  assert.match(source, /value="all_friends"/);
  assert.match(source, /value="selected_friends"/);
  assert.match(source, /value="only_me"/);
  assert.match(source, /name="audienceIds"/);
  assert.match(source, /friend-audience/);
  assert.match(app, /audienceMode/);
  assert.match(app, /audienceIds/);
});

test('daily schedule selects all seven days and weekday edits switch to specific days', () => {
  const source = slice('habitSheet', 'settingsSheet');
  assert.match(source, /scheduleFrequency === 'daily'/);
  assert.match(source, /scheduleFrequency === 'daily' \|\| scheduleWeekdays\.has\(day\)/);
  assert.match(app, /scheduleFrequency.*addEventListener\('change'/s);
  assert.match(app, /scheduleWeekdays.*scheduleFrequency.*selected_weekdays/s);
});

test('pause dates are bounded and overlapping or reversed pauses are rejected in the UI', () => {
  assert.match(app, /startDate.*endDate.*overlap|overlap.*startDate.*endDate/s);
  assert.match(app, /startDate > endDate|startDate\.localeCompare\(endDate\)/);
  assert.match(social, /\.schedule-pause \.form-grid\{[^}]*minmax\(0,1fr\)/);
  assert.match(social, /\.schedule-pause[^{]*\{|\.schedule-pause \.form-grid/);
});

test('repeated default proof subtitle is suppressed while authored notes remain visible', () => {
  assert.match(app, /Done\. Proof beats promises\.|activityMessage/);
  assert.match(app, /activityMessage \? `<p>/);
});

test('friend invite methods are preferred with legacy circle invite fallback', () => {
  assert.match(app, /repo\.createFriendInvite/);
  assert.match(app, /repo\.acceptFriendInvite/);
  assert.match(app, /repo\.createFriendInvite \? repo\.createFriendInvite/);
  assert.match(app, /repo\.acceptFriendInvite \? repo\.acceptFriendInvite/);
  assert.match(app, /repo\.joinCircle/);
});
