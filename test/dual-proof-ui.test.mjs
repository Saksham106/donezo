import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(start, end) {
  return app.slice(app.indexOf(`function ${start}`), app.indexOf(`function ${end}`));
}

test('habit editor exposes photo proof without a separate dual habit mode', () => {
  assert.match(app, /value="photo"[^>]*>[^<]*Photo proof/i);
  assert.match(app, /value="none"[^>]*>[^<]*Truuust me/i);
  assert.doesNotMatch(app, /value="dual_photo"/);
  assert.match(app, /requiresPhotoProof/);
});

test('dual photo capture uses native rear and selfie inputs in either order', () => {
  assert.match(app, /createDualProofState/);
  assert.match(app, /setDualProofFile/);
  assert.match(app, /composeDualProof/);
  assert.doesNotMatch(app, /getUserMedia|dualCameraSupported|captureVideoFrame/);
  assert.match(html, /id="proof-selfie-input"[^>]*capture="user"/);
  assert.match(html, /id="dual-proof-main-input"[^>]*capture="environment"/);
});

test('dual proof review can replace either side without losing the other role', () => {
  const review = slice('proofReviewSheet', 'clearDualProof');
  assert.match(review, /data-dual-replace-main/);
  assert.match(review, /data-dual-replace-selfie/);
  assert.match(app, /setDualProofFile/);
});

test('regular photo habits retain camera library and paste options', () => {
  const source = slice('proofSourceSheet', 'proofReviewSheet');
  assert.match(source, /data-proof-camera/);
  assert.match(source, /data-proof-gallery/);
  assert.match(source, /data-proof-paste/);
});
