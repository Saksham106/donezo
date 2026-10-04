import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

test('installed app requests portrait orientation', () => {
  assert.equal(manifest.orientation, 'portrait');
  assert.match(app, /orientation\?\.lock\?\.\(['"]portrait['"]\)/);
});

test('proof cards lazy-load full inline media', () => {
  assert.match(app, /data-proof-image/);
  assert.match(app, /IntersectionObserver/);
  assert.match(css, /\.proof-media/);
  assert.match(css, /\.proof-media img\{[^}]*width:100%[^}]*height:auto[^}]*object-fit:contain/);
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
