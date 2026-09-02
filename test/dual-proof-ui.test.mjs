import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(start, end) {
  return app.slice(app.indexOf(`function ${start}`), app.indexOf(`function ${end}`));
}

test('habit editor exposes a configured dual-photo proof mode', () => {
  assert.match(app, /value="dual_photo"[^>]*>[^<]*Dual photo/i);
  assert.match(app, /requiresPhotoProof/);
});

test('dual photo capture has rear and selfie camera paths with a native fallback', () => {
  assert.match(app, /createDualProofState/);
  assert.match(app, /dualCameraSupported/);
  assert.match(app, /captureVideoFrame/);
  assert.match(app, /composeDualProof/);
  assert.match(app, /getUserMedia/);
  assert.match(html, /id="proof-selfie-input"[^>]*capture="user"/);
  assert.match(html, /id="proof-input"[^>]*capture="environment"/);
});

test('dual proof review can retake either side without restarting both captures', () => {
  assert.match(app, /data-dual-retake-main/);
  assert.match(app, /data-dual-retake-selfie/);
  assert.match(app, /transitionDualProof/);
});

test('regular photo habits retain camera library and paste options', () => {
  const source = slice('proofSourceSheet', 'proofReviewSheet');
  assert.match(source, /data-proof-camera/);
  assert.match(source, /data-proof-gallery/);
  assert.match(source, /data-proof-paste/);
});
