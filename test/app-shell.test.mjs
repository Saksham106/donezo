import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const components = await readFile(new URL('../components.css', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('primary navigation is daily-use focused', () => {
  assert.match(app, /Check In/);
  assert.doesNotMatch(app, /\['add',\s*'\+',\s*'Add'\]/);
  assert.match(app, /data-profile/);
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
  assert.match(app, /Invite friends/);
  assert.match(app, /Lock in bro/);
});

test('habit sheet defaults to photo proof and cannot horizontally overflow', () => {
  assert.match(app, /value="photo" selected>Photo \/ screenshot/);
  assert.match(app, />Truuust me</);
  assert.match(components, /\.sheet[^}]*overflow-x:\s*hidden/);
  assert.match(components, /input\[type="time"\]/);
});

test('component stylesheet ships in both production build and offline cache', () => {
  assert.match(css, /components\.css/);
  assert.match(build, /components\.css/);
  assert.match(serviceWorker, /components\.css/);
  assert.match(serviceWorker, /addEventListener\('push'/);
});
