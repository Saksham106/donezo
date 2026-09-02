import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

// Existing app-shell contracts plus bounded mobile/proof UX behavior.
test('primary navigation is daily-use focused', () => {
  assert.match(app, /item\('today', 'home', 'Today'\)/);
  assert.match(app, /item\('friends', 'people', 'Friends'\)/);
  assert.match(app, /data-checkin-action/);
  assert.match(app, /item\('league', 'trophy', 'League'\)/);
  assert.match(app, /item\('me', 'user', 'Me'\)/);
});

test('mobile shell locks zoom and contains itself inside the physical viewport', () => {
  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
  assert.match(styles, /html,body\{[^}]*overflow:hidden/);
  assert.match(styles, /#app\{[^}]*position:fixed/);
  assert.match(styles, /\.app-shell\{[^}]*position:fixed/);
  assert.match(styles, /\.content-scroll\{[^}]*overflow-y:auto/);
});

test('bottom nav caps oversized iOS safe-area insets and sits low', () => {
  assert.match(styles, /--app-safe-bottom:clamp\(/);
  assert.match(styles, /\.nav\{[^}]*padding:[^;]*var\(--app-safe-bottom\)/);
});

test('Squad uses a People entry point and keeps Invite inside the People sheet', () => {
  assert.match(app, /data-people-open/);
  assert.match(app, /peopleSheet/);
  assert.match(app, /data-invite-from-people/);
});

test('social UX exposes settings, nudge inbox\/composer, proof votes and invite on Squad', () => {
  assert.match(app, /data-settings/);
  assert.match(app, /data-nudge-inbox/);
  assert.match(app, /nudge-form/);
  assert.match(app, /data-request-reject/);
  assert.match(app, /data-confirm-reject/);
  assert.match(app, /data-invite-open/);
  assert.match(app, /Lock in bro/);
});

test('habit sheet defaults to photo proof and cannot horizontally overflow', () => {
  assert.match(app, /const proofMode = editing\?\.proofMode \|\| 'photo'/);
  assert.match(app, /const targetTime = editMode \? \(editing\.targetTime \?\? ''\) : '20:00'/);
  assert.match(app, /value="photo" \$\{proofMode === 'photo' \? 'selected' : ''\}>Photo proof/);
  assert.match(app, />Truuust me</);
  assert.match(social, /\.sheet[^}]*overflow-x:\s*hidden/);
  assert.match(social, /input\[type="time"\]/);
});

test('photo proof flow is review-first, mobile-camera aware, and compression-race safe', () => {
  assert.match(html, /id="proof-input"[^>]*accept="image\/\*"[^>]*capture="environment"/);
  assert.match(app, /proofReviewSheet/);
  assert.match(app, /Submit proof/);
  assert.match(app, /Retake/);
  assert.match(app, /Choose another/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /URL\.revokeObjectURL/);
  assert.match(app, /proofPreparationId/);
  assert.match(app, /MAX_PROOF_BYTES/);
  assert.match(app, /compressProofFile/);
});

test('photo proof can be pasted from the clipboard without automatic clipboard access', () => {
  assert.match(app, /data-proof-paste/);
  assert.match(app, /readClipboardImage/);
  assert.match(app, /handlePasteProof/);
  assert.match(app, /paste/);
});

test('proof images stay inline and preserve context', () => {
  assert.match(app, /data-proof-image/);
  assert.match(app, /loadProofThumbnail/);
  assert.match(app, /IntersectionObserver/);
});

test('inline proof loader handles expired image URLs without a viewer', () => {
  assert.match(app, /proofThumbnailUrls\.delete\(path\)/);
  assert.doesNotMatch(app, /proofViewer/);
});

test('social stylesheet and service worker additions ship in production', () => {
  assert.match(html, /social\.css|styles\.css/);
  assert.match(sw, /network/i);
});

test('shared circle freshness is wired without replacing the app architecture', () => {
  assert.match(app, /navigator\.onLine/);
  assert.match(app, /renderPreservingScroll/);
  assert.match(app, /refreshCoordinator\?\.stop\(\)/);
  assert.match(app, /data-manual-refresh/);
  assert.match(app, /manualRefreshLoading/);
  assert.match(app, /refreshRepositoryData/);
  assert.match(app, /Offline · reconnect to refresh/);
});

test('auth boot ignores stale repository loads after a session change', () => {
  assert.match(app, /bootGeneration/);
  assert.match(app, /if \(generation !== bootGeneration/);
});

test('invite flow is compact, shareable, explicit and preserved through auth', () => {
  assert.match(app, /data-share-invite/);
  assert.match(app, /navigator\.share/);
  assert.match(app, /buildAuthRedirectUrl/);
  assert.match(app, /pendingInvite/);
});
