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

test('social UX exposes settings, nudge inbox/composer, proof votes and invite on Squad', () => {
  assert.match(app, /data-settings/);
  assert.match(app, /data-nudge-inbox/);
  assert.match(app, /nudge-form/);
  assert.match(app, /data-downvote/);
  assert.match(app, /data-invite-open/);
  assert.match(app, /Lock in bro/);
});

test('habit sheet defaults to photo proof and cannot horizontally overflow', () => {
  assert.match(app, /value="photo" selected>Photo \/ screenshot/);
  assert.match(app, />Truuust me</);
  assert.match(social, /\.sheet[^}]*overflow-x:\s*hidden/);
  assert.match(social, /input\[type="time"\]/);
});

test('social stylesheet and service worker additions ship in production', () => {
  assert.match(css, /social\.css/);
  assert.match(build, /social\.css/);
  assert.match(serviceWorker, /social\.css/);
  assert.match(serviceWorker, /addEventListener\('push'/);
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
  assert.match(social, /\.offline-indicator/);
  assert.match(social, /\.refresh-btn/);
});

test('invite flow is compact, shareable, explicit and preserved through auth', () => {
  assert.match(app, /navigator\.share/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /buildAuthRedirectUrl/);
  assert.match(app, /pendingInvite/);
  assert.match(app, /data-dismiss-invite/);
  assert.match(app, /data-invite-open/);
  assert.match(app, /data-copy-code/);
  assert.match(app, /data-continue-app/);
  assert.match(app, /createdCircleInvite/);
  assert.match(app, /Join friends/);
  assert.match(app, /value="\$\{esc\(pendingInvite\.code/);
  assert.match(social, /\.invite-icon-btn/);
  assert.doesNotMatch(app, /<section class="invite-card">/);
});
