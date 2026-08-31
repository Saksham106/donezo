import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const invite = await readFile(new URL('../src/invite.js', import.meta.url), 'utf8');
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

test('Friends renders authorized Proofs and Activity feeds with compact heading actions', () => {
  const source = slice('friendsScreen', 'challengeProgress');
  assert.match(source, /friends-heading-row/);
  assert.match(source, /data-people-open/);
  assert.match(source, /data-manual-refresh/);
  assert.match(source, /activityList\(state\)/);
  assert.match(source, /data-squad-feed="proofs"/);
  assert.match(source, /data-squad-feed="activity"/);
  assert.match(source, /squadFeed === 'proofs'/);
  assert.match(source, /groupSquadActivity/);
  assert.match(source, /activity\.type === 'grouped_checkin'/);
  assert.match(source, /activity\.items\.length/);
  assert.doesNotMatch(source, /One feed for the people you choose to show up with/);
  assert.doesNotMatch(source, /Hype your people|See what happened/);
  assert.match(social, /\.friends-heading-row\{[^}]*align-items:center/);
  assert.match(social, /\.friends-heading-actions\{[^}]*padding-bottom:0/);
});

test('Friends and League prefer new state while preserving member fallbacks', () => {
  assert.match(app, /function friendList\(state = getState\(\)\)/);
  assert.match(app, /state\?\.friends/);
  assert.match(app, /state\??\.members/);
  const league = slice('leagueScreen', 'challengeInfoSheet');
  assert.match(league, /Your League/);
  assert.match(league, /leagueMembers\(state\)/);
});

test('People and profiles make friend requests and friend-of-friend adds obvious', () => {
  const people = slice('peopleSheet', 'proofRejectSheet');
  const profile = slice('friendProfileSheet', 'recoverySheet');
  assert.match(people, /Friend requests/);
  assert.match(people, /data-accept-friend/);
  assert.match(profile, /Their friends/);
  assert.match(profile, /data-add-friend/);
  assert.match(profile, /data-accept-friend/);
  assert.match(app, /repo\.loadFriendConnections/);
  assert.match(app, /repo\.inviteFriend/);
  assert.match(app, /repo\.acceptFriend/);
});

test('every League row opens a profile and shows timezone-correct daily accountability', () => {
  const league = slice('leagueScreen', 'challengeInfoSheet');
  const profile = slice('friendProfileSheet', 'recoverySheet');
  assert.match(league, /data-friend-profile/);
  assert.match(league, /accountabilityDateForMember\(item, accountabilityNow\)/);
  assert.match(league, /dailyAccountabilitySummary\(item\.id, state\.habits, state\.checkIns, memberDate\)/);
  assert.match(profile, /accountabilityDateForMember\(person\)/);
  assert.match(profile, /dailyAccountabilitySummary\(person\.id, state\.habits, state\.checkIns, memberDate\)/);
  assert.match(league, /Today/);
  assert.match(league, /Yesterday/);
  assert.match(league, /league-daily-status/);
});

test('global Proofs stay chronological while profiles offer a newest-first swipeable proof history', () => {
  const friends = slice('friendsScreen', 'challengeProgress');
  const profile = slice('friendProfileSheet', 'recoverySheet');
  assert.match(app, /function personProofCarousel/);
  assert.match(app, /new Date\(b\.when\).*new Date\(a\.when\)/s);
  assert.doesNotMatch(friends, /personProofCarousel/);
  assert.match(profile, /personProofCarousel\(person\.id, recent\)/);
  assert.match(profile, /All activity/);
  assert.match(social, /\.profile-proof-carousel\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(social, /\.profile-proof-card\{[^}]*scroll-snap-align:start/);
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
  assert.match(app, /habit\?\.audienceMode \|\| habit\?\.audience/);
  assert.match(app, /habit\?\.selectedFriendIds/);
  assert.match(source, /audience-mode-grid/);
  assert.match(source, /data-friend-audience-list/);
  assert.doesNotMatch(source, /audienceIds\.has\(friendId\) \|\| audienceMode === 'all_friends'/);
  assert.match(app, /audienceMode !== 'selected_friends'/);
  assert.match(app, /checkbox\.checked = false/);
  assert.match(social, /\.audience-mode-card/);
});

test('editing a habit exposes a dirty-state floating Save Changes action', () => {
  const source = slice('habitSheet', 'settingsSheet');
  assert.match(source, /data-habit-save-dock/);
  assert.match(source, /form="habit-form"/);
  assert.match(source, /Save changes/);
  assert.match(app, /markHabitDirty/);
  assert.match(app, /habitForm\?\.addEventListener\('input', markHabitDirty\)/);
  assert.match(app, /habitForm\?\.addEventListener\('change', markHabitDirty\)/);
  assert.match(app, /repo\.updateHabit\(habitId, input\)[\s\S]*preserveDraft: true/);
  assert.match(app, /repo\.addHabit\(input\)[\s\S]*preserveDraft: true/);
  assert.match(app, /if \(!preserveDraft\) renderPreservingScroll\(\)/);
  assert.match(social, /\.habit-save-dock\{[^}]*position:fixed/);
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
  assert.match(app, /redeemInvite\(repo, validation\.code\)/);
  assert.match(invite, /repository\?\.acceptFriendInvite/);
  assert.match(invite, /repository\?\.joinCircle/);
});

test('friend nudges are private and do not expose unrelated friend networks', () => {
  const composer = slice('nudgeComposerSheet', 'nudgeInboxSheet');
  assert.match(composer, /Only .* sees it\./s);
  assert.doesNotMatch(composer, /Public callout|whole squad|name="visibility"/i);
});

test('active Friends surfaces do not leak obsolete squad or people copy', () => {
  assert.doesNotMatch(app, /joining your friend’s squad/i);
  assert.doesNotMatch(app, /visible to this squad/i);
  assert.doesNotMatch(app, /See the squad awards/i);
  assert.doesNotMatch(app, /until the squad finishes/i);
  assert.doesNotMatch(app, /What are squad challenges/i);
  assert.doesNotMatch(app, /Let the squad include your name/i);
  assert.doesNotMatch(app, /<strong>Squad Baton<\/strong>/i);
  assert.doesNotMatch(app, /Your squad showed up/i);
  assert.match(app, /people\.length === 1 \? 'friend' : 'friends'/);
});
