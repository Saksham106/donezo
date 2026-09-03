import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('Requested and Friends are tappable relationship controls', () => {
  const action = section(app, 'function peopleRelationshipAction(', 'function peoplePersonRow(');
  assert.match(action, /relationship === 'outgoing'[^]*data-people-cancel/);
  assert.match(action, /data-people-cancel="\$\{esc\(person\.requestId\)\}"/);
  assert.match(action, /relationship === 'friend'[^]*data-people-remove/);
  assert.doesNotMatch(action, /relationship === 'outgoing'[^;]*disabled/);
  assert.doesNotMatch(action, /relationship === 'friend'[^;]*disabled/);
});

test('outgoing cancellation is optimistic, clears request id, and rolls back on failure', () => {
  assert.match(app, /let friendRemovalPerson = null/);
  const sync = section(app, 'function syncPeopleRelationship(', 'async function handlePeopleAdd(');
  assert.match(sync, /arguments\.length >= 3|hasRequestId/);
  const cancel = section(app, 'async function handlePeopleCancel(', 'async function handlePeopleAccept(');
  assert.match(cancel, /syncPeopleRelationship\(userId, 'available', null\)/);
  assert.match(cancel, /repo\.cancelFriendRequest\(requestId\)/);
  assert.match(cancel, /previousSearch/);
  assert.match(cancel, /previousSuggestions/);
  assert.match(cancel, /Friend request unsent/);
  assert.doesNotMatch(cancel, /\brender\(\)/);
});

test('Friends opens a small Remove friend confirmation instead of navigating to profile', () => {
  const sheet = section(app, 'function friendRemovalSheet()', 'function peopleRelationshipAction(');
  assert.match(sheet, /Remove friend/);
  assert.match(sheet, /data-confirm-friend-removal/);
  assert.match(sheet, /data-cancel-friend-removal/);
  const remove = section(app, 'async function handlePeopleRemoveFriend()', 'function peopleRelationshipAction(');
  assert.match(remove, /repo\.removeFriend\(person\.id\)/);
  assert.match(remove, /syncPeopleRelationship\(person\.id, 'available', null\)/);
  assert.match(remove, /friendRemovalPerson = null/);
  assert.doesNotMatch(remove, /openFriendProfile|\brender\(\)/);
});

test('People bindings route Requested and Friends through reversible controls', () => {
  const bindings = section(app, 'function bindPeopleSheetActions()', 'function openPeopleSheet()');
  assert.match(bindings, /data-people-cancel/);
  assert.match(bindings, /handlePeopleCancel/);
  assert.match(bindings, /data-people-remove/);
  assert.match(bindings, /friendRemovalPerson/);
  assert.match(bindings, /data-confirm-friend-removal/);
  assert.match(bindings, /handlePeopleRemoveFriend/);
});
