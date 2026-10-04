import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;

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
