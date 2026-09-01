import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('primary navigation is daily-use focused', () => {
  assert.match(app, /Check In/);
  assert.doesNotMatch(app, /\['add',\s*'\+',\s*'Add'\]/);
  assert.match(app, /data-settings/);
  assert.doesNotMatch(app, /name="xp"/);
});

test('mobile shell locks zoom and contains itself inside the physical viewport', () => {
  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
  assert.match(css, /\.app-shell/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.content-scroll/);
  assert.match(css, /overflow-y:\s*auto/);
});

test('bottom nav caps oversized iOS safe-area insets and sits low', () => {
  assert.match(css, /--app-safe-bottom:\s*clamp\(\.45rem,\s*env\(safe-area-inset-bottom\),\s*1\.5rem\)/);
  assert.match(css, /\.nav\{[^}]*padding:[^;}]*var\(--app-safe-bottom\)/s);
  assert.match(css, /\.nav-btn\{[^}]*min-height:\s*3\.35rem/s);
  assert.match(css, /\.nav-btn\.checkin \.nav-icon\{[^}]*margin-top:\s*0/s);
  assert.match(css, /@media\(min-width:700px\)[\s\S]*#app\{position:fixed;inset:var\(--space-6\) 0 0;height:auto/);
  assert.match(css, /@media\(min-width:700px\)[\s\S]*\.app-shell\{[^}]*height:100%/);
  assert.doesNotMatch(css, /\.nav\{[^}]*padding:[^;}]*calc\([^;}]*env\(safe-area-inset-bottom\)/s);
});

test('Squad uses a People entry point and keeps Invite inside the People sheet', () => {
  assert.match(app, /people:/);
  assert.match(app, /data-people-open[^`]*\$\{icon\('people'\)\}/s);
  assert.match(app, /function peopleSheet/);
  assert.match(app, /data-invite-from-people[^`]*\$\{icon\('userPlus'\)\}/s);
  assert.doesNotMatch(app, /data-people-open[^`]*\$\{icon\('share'\)\}/s);
});

test('social UX exposes settings, nudge inbox/composer, proof votes and invite on Squad', () => {
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
  assert.match(app, /value="photo" \$\{proofMode === 'photo' \? 'selected' : ''\}>Photo \/ screenshot/);
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
  assert.match(app, /const habitId = proofHabit \|\| proofReview\?\.habitId/);
  assert.match(app, /currentHabitId !== habitId/);
  assert.match(app, /completeWithProof/);
});

test('photo proof can be pasted from the clipboard without automatic clipboard access', () => {
  assert.match(app, /data-proof-paste/);
  assert.match(app, /readClipboardImage/);
  assert.match(app, /addEventListener\('paste'/);
  assert.match(app, /clipboardData/);
  assert.match(app, /addEventListener\('paste',[\s\S]*prepareProofFile\(file\)/);
});

test('proof viewing stays inside the app and preserves context', () => {
  assert.doesNotMatch(app, /window\.open\(/);
  assert.match(app, /proofViewerSheet/);
  assert.match(app, /getProofUrl/);
  assert.match(app, /data-proof-viewer-retry/);
  assert.match(app, /View proof/);
  assert.match(app, /activity\.habitTitle/);
  assert.match(app, /formatWhen\(activity\.when\)/);
});

test('proof viewer ignores stale signed-link and image failures', () => {
  assert.match(app, /proofViewerRequestId/);
  assert.match(app, /requestId !== proofViewerRequestId/);
  assert.match(app, /proofViewer\?\.url !== expectedUrl/);
});

test('social stylesheet and service worker additions ship in production', () => {
  assert.match(css, /social\.css/);
  assert.match(build, /social\.css/);
  assert.match(serviceWorker, /social\.css/);
  assert.match(serviceWorker, /addEventListener\('push'/);
  assert.match(serviceWorker, /donezo-shell-v26/);
});

test('shared circle freshness is wired without replacing the app architecture', () => {
  assert.match(app, /createRefreshCoordinator/);
  assert.match(app, /intervalMs:\s*30_000/);
  assert.match(app, /visibilityState\s*===\s*'visible'/);
  assert.match(app, /navigator\.onLine/);
  assert.match(app, /renderPreservingScroll/);
  assert.match(app, /refreshCoordinator\?\.stop\(\)/);
  assert.match(app, /data-manual-refresh/);
  assert.match(app, /manualRefreshLoading/);
  assert.match(app, /refreshRepositoryData/);
  assert.match(app, /Offline · reconnect to refresh/);
  assert.doesNotMatch(app, /Offline · showing last sync/);
  assert.match(social, /\.offline-indicator/);
  assert.match(social, /\.refresh-btn/);
});

test('auth boot ignores stale repository loads after a session change', () => {
  assert.match(app, /bootGeneration/);
  assert.match(app, /generation !== bootGeneration/);
  assert.match(app, /nextSession\?\.user\?\.id !== session\?\.user\?\.id/);
});

test('invite flow is compact, shareable, explicit and preserved through auth', () => {
  assert.match(app, /navigator\.share/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /buildAuthRedirectUrl/);
  assert.match(app, /pendingInvite/);
  assert.match(app, /data-dismiss-invite/);
  assert.match(app, /data-invite-open/);
  assert.doesNotMatch(app, /data-copy-code/);
  assert.match(app, /data-continue-app/);
  assert.match(app, /createdCircleInvite/);
  assert.match(app, /Join a squad/);
  assert.match(app, /const value = pendingInvite\.present/);
  assert.match(app, /value="\$\{esc\(value\)\}"/);
  assert.match(social, /\.invite-icon-btn/);
  assert.doesNotMatch(app, /<section class="invite-card">/);
});
