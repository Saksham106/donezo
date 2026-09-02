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

test('camera mode switch is visually obvious', () => {
  assert.match(social, /\.camera-mode-switch button\{[^}]*background:var\(--color-paper-2\)[^}]*color:var\(--color-ink\)/);
  assert.match(social, /\.camera-mode-switch button\.active\{[^}]*background:var\(--color-coral\)[^}]*color:var\(--color-white\)/);
});

test('camera sheet fits without vertical scrolling and removes nonessential copy', () => {
  const camera = section(app, 'function dualProofSheet()', 'function proofSourceSheet()');
  assert.doesNotMatch(camera, /proof-sheet-copy/);
  assert.doesNotMatch(camera, /<p class="eyebrow">/);
  assert.doesNotMatch(camera, /Opens the native camera/);
  assert.match(camera, /camera-capture-btn/);
  assert.match(camera, /Use iPhone camera for better quality/);
  assert.match(social, /\.dual-proof-sheet\{[^}]*overflow:hidden[^}]*display:flex[^}]*flex-direction:column/);
  assert.match(social, /\.dual-camera-frame\{[^}]*flex:1 1 auto[^}]*min-height:0/);
  assert.match(social, /\.camera-capture-btn\{[^}]*margin-top:/);
});

test('camera stream is reused instead of being re-requested on routine rerenders', () => {
  const draft = section(app, 'function hasUnsavedDraft()', 'async function refreshRepositoryData');
  assert.match(draft, /Boolean\(dualProof\)/);

  const start = section(app, 'async function startDualCameraIfNeeded()', 'async function finishDualSelection');
  assert.match(start, /dualCameraStream[^]*readyState === 'live'[^]*video\.srcObject = dualCameraStream[^]*return;/);
  assert.ok(start.indexOf("readyState === 'live'") < start.indexOf('getUserMedia'));

  const renderBindings = section(app, "app.querySelectorAll('[data-camera-mode]')", "app.querySelector('[data-dual-capture]')");
  assert.doesNotMatch(renderBindings, /clearDualProof\(\)/);
  assert.match(renderBindings, /dualProof = \{ \.\.\.dualProof, mode \}/);

  const fallback = section(app, 'function openNativeCameraFallback(input)', 'function clearDualProof()');
  assert.doesNotMatch(fallback, /stopDualCamera\(\)/);
  assert.match(fallback, /input\?\.click\(\)/);
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
