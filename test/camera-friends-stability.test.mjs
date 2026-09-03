import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('proof flow has no live Donezo camera lifecycle left to prompt or restart', () => {
  assert.doesNotMatch(app, /getUserMedia|startDualCameraIfNeeded|dualCameraStream|dualCameraRequestId|data-dual-camera|camera-mode-switch/);
  assert.doesNotMatch(social, /\.dual-camera-frame|\.camera-mode-switch|\.camera-quality-fallback/);
});

test('native proof review keeps the compact highlighted Make Dual action', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(review, /compact-proof-review-actions/);
  assert.match(review, /data-proof-choose[^>]*>Choose another/);
  assert.match(review, /data-proof-make-dual[^>]*>Make Dual/);
  assert.match(social, /\.proof-make-dual\{[^}]*background:var\(--color-coral-soft\)/);
});

test('Dual role selection uses native front or rear inputs instead of a stream', () => {
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.match(bindings, /role === 'main' \? proofSelfieInput : dualProofMainInput/);
  assert.match(bindings, /input\?\.click\(\)/);
  assert.doesNotMatch(bindings, /getUserMedia|startDualCameraIfNeeded/);
});

test('background refresh does not rebuild a scrolled Friends feed', () => {
  assert.match(app, /function shouldDeferFriendsRefreshRender\(\)/);
  assert.match(app, /tab === 'friends'/);
  assert.match(app, /scrollTop > 4/);
  const refresh = section(app, 'async function refreshRepositoryData', 'function startRefreshCoordinator');
  assert.match(refresh, /!shouldDeferFriendsRefreshRender\(\)[^]*renderPreservingScroll\(\)/);
  const coordinator = section(app, 'function startRefreshCoordinator', 'async function handleApplyPwaUpdate');
  assert.match(coordinator, /!shouldDeferFriendsRefreshRender\(\)[^]*renderPreservingScroll\(\)/);
});

test('manual refresh clears its spinner without rebuilding a scrolled Friends feed', () => {
  const manual = section(app, 'async function handleManualRefresh()', 'async function handleNotifications');
  assert.match(manual, /manualRefreshLoading = false;/);
  assert.match(manual, /syncManualRefreshButton\(\)/);
  const sync = section(app, 'function syncManualRefreshButton()', 'async function handleManualRefresh()');
  assert.match(sync, /querySelector\('\[data-manual-refresh\]'\)/);
  assert.match(sync, /classList\.toggle\('loading', manualRefreshLoading\)/);
  assert.match(sync, /disabled = manualRefreshLoading/);
});

test('reaction strip scrolls horizontally only', () => {
  assert.match(social, /\.reaction-row\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
});

test('proof rejection lives in the top-right card header, not the reaction strip', () => {
  const card = section(app, 'function activityCard(', 'function personProofCarousel');
  assert.match(card, /proof-card-heading-copy[\s\S]*\$\{rejectionControl\}<\/div>\$\{proofPreview\}/);
  assert.match(card, /class="reaction-row"[^`]*\$\{reactionButtons\}<\/div>/s);
  assert.doesNotMatch(card, /class="reaction-row"[^`]*rejectionControl/s);
  assert.match(social, /\.proof-card-header\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
});

test('Friends eyebrow sits tightly above the heading', () => {
  assert.match(social, /\.friends-heading>\.eyebrow\{margin-bottom:\.(?:1|2|25)rem\}/);
});
