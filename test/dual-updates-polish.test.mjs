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

test('Dual photo lives inside the Take photo camera rather than the source picker', () => {
  const picker = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  const camera = section(app, 'function dualProofSheet()', 'function proofSourceSheet()');
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.doesNotMatch(picker, /data-proof-dual/);
  assert.match(camera, /data-camera-mode="single"/);
  assert.match(camera, /data-camera-mode="dual"/);
  assert.match(bindings, /createDualProofState\(proofHabit, 'single'\)/);
});

test('Dual camera mode keeps independent retake controls', () => {
  const review = section(app, 'function proofReviewSheet()', 'function stopDualCamera()');
  assert.match(review, /cameraSession/);
  assert.match(review, /dualProof\?\.mode === 'dual'/);
  assert.match(review, /data-dual-retake-main/);
  assert.match(review, /data-dual-retake-selfie/);
});

test('proof rejection is visible in the proof header and kept out of the reaction row', () => {
  const card = section(app, 'function activityCard(', 'function personProofCarousel(');
  assert.match(card, /proof-card-heading-copy[\s\S]*\$\{rejectionControl\}<\/div>\$\{proofPreview\}/);
  assert.match(card, /class="vote-btn proof-rejection-inline/);
  assert.doesNotMatch(card, /reaction-row[^`]*\$\{rejectionControl\}/s);
  assert.match(social, /\.proof-rejection-inline\{[^}]*align-self:flex-start/);
});

test('Updates includes recipient notification events and only dedupes matching native rows', () => {
  assert.match(store, /from\('notification_events'\)\.select\([^\n]*metadata/);
  assert.match(store, /eq\('recipient_user_id', user\.id\)/);
  assert.match(store, /notificationEvents:/);
  assert.match(store, /metadata: event\.metadata/);

  const updates = section(app, 'function updatesList(', 'function unseenUpdatesCount(');
  assert.match(updates, /state\?\.notificationEvents/);
  assert.match(updates, /kind: 'notification'/);
  assert.match(updates, /nativeActivityCheckInIds/);
  assert.match(updates, /event\.category === 'nudge'/);
  assert.match(updates, /event\.category === 'friend_activity'[\s\S]*nativeActivityCheckInIds\.has\(event\.metadata\?\.checkInId\)/);
  assert.doesNotMatch(updates, /!\['nudge', 'friend_activity'\]\.includes\(event\.category\)/);

  const unseen = section(app, 'function unseenUpdatesCount(', 'async function openUpdatesCenter(');
  assert.match(unseen, /notificationCount/);
  assert.match(unseen, /notificationEvents/);
  assert.match(unseen, /visibleNotificationEvents/);

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
