import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createMemoryRepository } from '../src/store.js';

const migrationUrl = new URL('../supabase/migrations/20260902195000_searchable_people.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

test('searchable People migration makes usernames required and safe', () => {
  assert.match(migration, /alter table public\.profiles[\s\S]*username[\s\S]*not null/i);
  assert.match(migration, /\^\[a-z0-9\]/i);
  for (const name of ['admin', 'administrator', 'donezo', 'support', 'system']) {
    assert.match(migration, new RegExp(name, 'i'));
  }
  assert.match(migration, /unique/i);
});

test('discovery stays behind bounded authenticated RPCs', () => {
  assert.match(migration, /create or replace function public\.search_people\(search_query text, result_limit integer default 20\)/i);
  assert.match(migration, /create or replace function public\.suggest_people\(result_limit integer default 10\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path\s*=\s*''/i);
  assert.match(migration, /least\(20/i);
  assert.match(migration, /length\([^)]*\)\s*<\s*2/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+public\.profiles\s+to\s+authenticated/i);
  assert.match(migration, /grant execute on function public\.search_people/i);
  assert.match(migration, /grant execute on function public\.suggest_people/i);
});

test('discovery RPC result contract exposes no private columns', () => {
  for (const column of ['user_id uuid', 'username text', 'display_name text', 'avatar_url text', 'relationship_status text', 'request_id uuid', 'mutual_count bigint']) {
    assert.match(migration, new RegExp(column.replace(' ', '\\s+'), 'i'));
  }
  assert.doesNotMatch(migration, /returns table[\s\S]{0,500}\b(email|phone|timezone|recap_awards_enabled)\b/i);
});

test('profile pending-request RLS compares friend requests to the outer profile id', () => {
  assert.match(migration, /profiles_select_friends_or_requests/i);
  assert.match(migration, /request\.requester_id\s*=\s*profiles\.id/i);
  assert.match(migration, /request\.addressee_id\s*=\s*profiles\.id/i);
  assert.doesNotMatch(migration, /request\.requester_id\s*=\s*request\.id/i);
  assert.doesNotMatch(migration, /request\.addressee_id\s*=\s*request\.id/i);
});

function functionBlock(source, name, nextMarker = '\n  async function ') {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  let end = source.indexOf(nextMarker, start + 1);
  if (end < 0) end = source.length;
  return source.slice(start, end);
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('production repository exposes transient discovery RPC methods without full load', () => {
  for (const [name, rpc] of [
    ['searchPeople', 'search_people'],
    ['suggestPeople', 'suggest_people'],
    ['setMyUsername', 'set_my_username'],
  ]) {
    assert.match(store, new RegExp(`async function ${name}\\(`));
    const body = functionBlock(store, name);
    assert.match(body, new RegExp(`rpc\\(['\"]${rpc}['\"]`));
    if (name !== 'setMyUsername') assert.doesNotMatch(body, /\bload\s*\(/);
  }
});

test('discovery rows map only the safe public person shape', () => {
  assert.match(store, /function mapDiscoveryPerson\(/);
  for (const field of ['user_id', 'username', 'display_name', 'avatar_url', 'relationship_status', 'request_id', 'mutual_count']) {
    assert.match(store, new RegExp(field));
  }
});

const discoverySeed = {
  currentUserId: 'me',
  profiles: [
    { id: 'me', name: 'Me Person', username: 'meperson' },
    { id: 'alice', name: 'Alice Alpha', username: 'alice' },
    { id: 'bob', name: 'Bob Bridge', username: 'bobby' },
    { id: 'carol', name: 'Carol Current', username: 'carol' },
  ],
  members: [
    { id: 'me', name: 'Me Person', username: 'meperson', xp: 0 },
    { id: 'bob', name: 'Bob Bridge', username: 'bobby', xp: 0 },
  ],
  friendships: [
    { user_a: 'bob', user_b: 'me' },
    { user_a: 'alice', user_b: 'bob' },
  ],
  friendRequests: [],
  habits: [],
  checkIns: [],
  nudges: [],
};

test('memory discovery searches usernames and computes relationship-safe mutual counts', () => {
  const repo = createMemoryRepository(discoverySeed);
  const results = repo.searchPeople('@ali');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'alice');
  assert.equal(results[0].username, 'alice');
  assert.equal(results[0].relationship, 'available');
  assert.equal(results[0].mutualCount, 1);

  const byName = repo.searchPeople('alpha');
  assert.equal(byName[0].id, 'alice');
});

test('memory suggestions are mutual-only non-friends', () => {
  const repo = createMemoryRepository(discoverySeed);
  const suggestions = repo.suggestPeople();
  assert.deepEqual(suggestions.map((person) => person.id), ['alice']);
  assert.ok(suggestions.every((person) => person.mutualCount > 0));
  assert.ok(suggestions.every((person) => person.relationship !== 'friend'));
});

test('memory username setter normalizes self and rejects reserved or taken usernames', () => {
  const repo = createMemoryRepository(discoverySeed);
  assert.equal(repo.setMyUsername('Me.New'), 'me.new');
  assert.equal(repo.getState().profiles.find((person) => person.id === 'me').username, 'me.new');
  assert.throws(() => repo.setMyUsername('admin'), /reserved/i);
  assert.throws(() => repo.setMyUsername('bobby'), /taken/i);
});

test('People is a searchable full-height overlay with request badge and no new bottom tab', () => {
  const friends = section(app, 'function friendsScreen()', 'function challengeProgress');
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  const nav = section(app, 'function nav()', 'function openCheckInAction');
  assert.match(friends, /data-people-open/);
  assert.match(friends, /people-request-badge/);
  assert.match(people, /name="peopleSearch"/);
  assert.match(people, /placeholder="Search people"/);
  assert.doesNotMatch(people, /autofocus/);
  assert.match(social, /\.people-sheet[\s\S]{0,500}height:/);
  assert.doesNotMatch(nav, /People/);
});

test('default People view orders Requests Suggestions Friends and preserves invite fallbacks', () => {
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  const requests = people.indexOf('Requests');
  const suggested = people.indexOf('Suggested for you');
  const friends = people.indexOf('Friends');
  assert.ok(requests >= 0 && suggested > requests && friends > suggested);
  assert.match(people, /Have an invite code/);
  assert.match(people, /data-invite-from-people/);
  assert.match(people, /data-add-friend-from-people/);
});

test('People search is 2-character debounced latest-query-wins', () => {
  assert.match(app, /peopleSearchRequestId/);
  const search = section(app, 'function queuePeopleSearch(', 'async function loadPeopleSuggestions(');
  assert.match(search, /normalized\.length\s*<\s*2/);
  assert.match(search, /250/);
  assert.match(search, /\+\+peopleSearchRequestId/);
  assert.match(search, /requestId\s*!==\s*peopleSearchRequestId/);
  assert.match(search, /repo\.searchPeople/);
});

test('opening and refreshing People stays overlay-local instead of rebuilding Friends', () => {
  const helpers = section(app, 'function closePeopleSheet()', 'function proofRejectSheet');
  assert.match(helpers, /function refreshPeopleSheet\(/);
  assert.match(helpers, /function openPeopleSheet\(/);
  assert.match(helpers, /insertAdjacentHTML\(['\"]beforeend['\"],\s*peopleSheet\(\)\)/);
  assert.match(helpers, /bindPeopleSheetActions\(\)/);
  assert.doesNotMatch(helpers, /\brender\(\)/);
});

test('People rows expose Add Requested Accept Friends relationship states', () => {
  const people = section(app, 'function peopleRelationshipAction(', 'function peopleSheet()');
  for (const label of ['Add', 'Requested', 'Accept', 'Friends']) assert.match(people, new RegExp(`>${label}<|${label}`));
  assert.match(people, /mutual/i);
});

test('Profile & app exposes an editable username backed by setMyUsername', () => {
  const settings = section(app, 'function settingsSheet()', 'function nudgeComposerSheet()');
  assert.match(settings, /id="username-form"/);
  assert.match(settings, /name="username"/);
  assert.match(settings, /People can find you by this/);
  const handler = section(app, 'async function handleUsernameSubmit(', 'async function handleDisplayName(');
  assert.match(handler, /repo\.setMyUsername/);
  assert.doesNotMatch(handler, /render\([^)]*\)/);
  assert.match(app, /#username-form/);
});

test('non-friend discovery profile is intentionally minimal', () => {
  const discovery = section(app, 'function discoveryProfileSheet()', 'function peopleSheet()');
  assert.match(discovery, /peopleRelationshipAction/);
  assert.match(discovery, /mutual/i);
  assert.match(discovery, /username|handle/i);
  assert.doesNotMatch(discovery, /personProofCarousel|currentStreak|weeklyCompletionScore|activityList|habit/i);
});

test('People identity opens full profiles only for friends and minimal discovery otherwise', () => {
  assert.match(app, /let discoveryProfilePerson = null/);
  const router = section(app, 'function openPeoplePerson(', 'function peopleSheet()');
  assert.match(router, /relationship === 'friend'/);
  assert.match(router, /openFriendProfile/);
  assert.match(router, /discoveryProfilePerson/);
  assert.match(router, /refreshPeopleSheet/);
  const binding = section(app, 'function bindPeopleSheetActions()', 'function openPeopleSheet()');
  assert.match(binding, /openPeoplePerson/);
});
