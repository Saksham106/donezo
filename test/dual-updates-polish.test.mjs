import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('every normal photo-proof picker offers Dual photo', () => {
  const picker = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  const bindings = section(app, 'function bindProofActions()', 'async function handleProofSubmit()');
  assert.match(picker, /data-proof-dual/);
  assert.match(picker, />Dual photo</);
  assert.match(bindings, /\[data-proof-dual\]/);
  assert.match(bindings, /createDualProofState\(proofHabit\)/);
});

test('proof rejection shares the reaction row and is right aligned', () => {
  const card = section(app, 'function activityCard(', 'function personProofCarousel(');
  assert.match(card, /reaction-row[^`]*\$\{rejectionControl\}/s);
  assert.match(card, /class="vote-btn proof-rejection-inline/);
  assert.doesNotMatch(card, /const proofActions[^\n]*data-request-reject/);
  assert.match(social, /\.proof-rejection-inline\{[^}]*margin-left:auto/);
});

test('Updates includes recipient notification events without duplicating native nudge or friend activity rows', () => {
  assert.match(store, /from\('notification_events'\)\.select\(/);
  assert.match(store, /eq\('recipient_user_id', user\.id\)/);
  assert.match(store, /notificationEvents:/);

  const updates = section(app, 'function updatesList(', 'function unseenUpdatesCount(');
  assert.match(updates, /state\?\.notificationEvents/);
  assert.match(updates, /kind: 'notification'/);
  assert.match(updates, /!\['nudge', 'friend_activity'\]\.includes\(event\.category\)/);

  const unseen = section(app, 'function unseenUpdatesCount(', 'async function openUpdatesCenter(');
  assert.match(unseen, /notificationCount/);
  assert.match(unseen, /notificationEvents/);

  const sheet = section(app, 'function nudgeInboxSheet()', 'function inviteSheet()');
  assert.match(sheet, /item\.kind === 'notification'/);
  assert.match(sheet, /update-notification-row/);
});

test('top bar keeps Updates and settings but removes the redundant Friends shortcut', () => {
  const topbar = section(app, 'function topbar()', 'function offlineIndicator');
  assert.match(topbar, /data-nudge-inbox/);
  assert.match(topbar, /data-settings/);
  assert.doesNotMatch(topbar, /friendsLink/);
  assert.doesNotMatch(topbar, /data-friends/);
});
