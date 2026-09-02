import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

test('proof cards render complete inline images rather than cropped proof buttons', () => {
  assert.match(app, /class="proof-media"/);
  assert.match(app, /data-proof-image=/);
  assert.match(social, /\.proof-media[^}]*overflow:hidden/);
  assert.match(social, /\.proof-media img\{[^}]*width:100%[^}]*height:auto[^}]*object-fit:contain/);
  assert.doesNotMatch(app, />Open proof<\/button>/);
});

test('standalone proof viewer is removed while signed proof urls stay lazy-loaded inline', () => {
  assert.doesNotMatch(app, /function proofViewerSheet/);
  assert.doesNotMatch(app, /proofViewerRequestId/);
  assert.doesNotMatch(app, /let proofViewer\s*=/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /getProofUrl/);
  assert.match(app, /data-proof-image/);
});

test('profile proof history inherits the same full-image proof card renderer', () => {
  assert.match(app, /personProofCarousel[\s\S]*activityCard\(proof, \{ showProofActions: true \}\)/);
});
