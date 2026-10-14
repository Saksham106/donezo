import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
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

test('reaction strip scrolls horizontally only', () => {
  assert.match(social, /\.reaction-row\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
});

test('Friends eyebrow sits tightly above the heading', () => {
  assert.match(social, /\.friends-heading>\.eyebrow\{margin-bottom:\.(?:1|2|25)rem\}/);
});
