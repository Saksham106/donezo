import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

test('installed app requests portrait orientation', () => {
  assert.equal(manifest.orientation, 'portrait');
  assert.match(app, /orientation\?\.lock\?\.\(['"]portrait['"]\)/);
});

test('Friends is a proof-only feed without persisted feed-tab state', () => {
  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress'));
  assert.match(friends, /filter\(\(activity\) => activity\.proofPath\)/);
  assert.doesNotMatch(app, /donezo\.squadFeed/);
  assert.doesNotMatch(app, /data-squad-feed/);
});

test('proof cards lazy-load full inline media', () => {
  assert.match(app, /data-proof-image/);
  assert.match(app, /IntersectionObserver/);
  assert.match(css, /\.proof-media/);
  assert.match(css, /\.proof-media img\{[^}]*width:100%[^}]*height:auto[^}]*object-fit:contain/);
});

test('Squad Baton uses a compact one-row treatment', () => {
  assert.match(app, /baton-compact/);
  assert.match(css, /\.baton-card\.baton-compact/);
});

test('notification settings use structured mobile cards', () => {
  assert.match(app, /notification-hero/);
  assert.match(app, /notification-panel/);
  assert.match(app, /notification-option/);
  assert.match(css, /\.notification-hero/);
  assert.match(css, /\.notification-option/);
  assert.match(app, /notification-option-toggle/);
  assert.match(css, /\.notification-form\{display:grid[^}]*padding:0[^}]*border:0/);
});

test('closing a Settings detail returns to Settings menu', () => {
  assert.match(app, /\[data-close-settings\][\s\S]*settingsView !== ['"]menu['"]/);
});

test('People profile and invite flows return to the People sheet', () => {
  assert.match(app, /data-close-friend-profile/);
  assert.match(app, /friendProfileUserId = null;[\s\S]*peopleSheetOpen = true/);
  assert.match(app, /data-invite-from-people[\s\S]*inviteSheetOpen = true/);
  assert.match(app, /data-close-invite[\s\S]*inviteSheetOpen = false/);
});

test('People flow sheets share a stable phone height', () => {
  assert.match(app, /people-flow-sheet/);
  assert.match(css, /\.people-flow-sheet/);
  assert.match(css, /height:min\(60dvh,32rem\)/);
});
