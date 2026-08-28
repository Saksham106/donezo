import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('primary navigation is daily-use focused', () => {
  assert.match(app, /Check In/);
  assert.doesNotMatch(app, /\['add',\s*'\+',\s*'Add'\]/);
  assert.match(app, /data-profile/);
  assert.doesNotMatch(app, /name="xp"/);
});

test('mobile shell locks zoom and isolates scrolling between safe areas', () => {
  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
  assert.match(css, /\.app-shell/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.content-scroll/);
  assert.match(css, /overflow-y:\s*auto/);
});
