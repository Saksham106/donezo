import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('proof source is native-only and removes the Donezo live camera surface', () => {
  const source = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  assert.match(source, /data-proof-camera[^>]*>Take photo/);
  assert.match(source, /data-proof-gallery[^>]*>Choose from library/);
  assert.match(source, /data-proof-paste[^>]*>Paste copied photo/);
  assert.doesNotMatch(source, /Use Donezo camera|data-proof-donezo-camera/);
  assert.doesNotMatch(app, /navigator\.mediaDevices\.getUserMedia|startDualCameraIfNeeded|dualCameraStream|dualCameraRequestId|data-dual-camera|camera-mode-switch/);
  assert.match(html, /id="proof-input"[^>]*capture="environment"/);
  assert.match(html, /id="dual-proof-main-input"[^>]*capture="environment"/);
  assert.match(html, /id="proof-selfie-input"[^>]*capture="user"/);
});

test('single proof review uses one compact Choose another and Make Dual row', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(review, /data-proof-choose[^>]*>Choose another/);
  assert.match(review, /data-proof-make-dual[^>]*>Make Dual/);
  assert.match(review, /compact-proof-review-actions/);
  assert.match(review, /proof-make-dual/);
  assert.doesNotMatch(review, />Retake(?: proof| selfie)?</);
  assert.match(css, /\.proof-make-dual[^}]*background:/);
});

test('Make Dual asks what the first photo was inside the existing review and opens the opposite native camera', () => {
  assert.match(app, /let dualRoleChoice = null/);
  const roleControls = section(app, 'function dualRoleChoiceControls()', 'function proofSourceSheet()');
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(roleControls, /What was this photo\?/);
  assert.match(roleControls, />Main proof</);
  assert.match(roleControls, />Selfie</);
  assert.match(roleControls, /role="group"[^>]*aria-label="Choose first photo role"/);
  assert.match(review, /dualRoleChoiceControls\(\)/);
  assert.match(review, /proof-preview-frame[^]*\$\{reviewActions\}/);
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.match(bindings, /data-proof-make-dual/);
  assert.match(bindings, /data-dual-first-role/);
  assert.match(bindings, /querySelector\('\[data-dual-first-role\]'\)\?\.focus\(\)/);
  assert.match(bindings, /querySelector\('\[data-proof-make-dual\]'\)\?\.focus\(\)/);
  assert.match(bindings, /role === 'main' \? proofSelfieInput : dualProofMainInput/);
  assert.match(bindings, /input\?\.click\(\)/);
});

test('role choice swaps only the review controls while preserving the photo', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(review, /if \(!proofReview\) return '';/);
  assert.doesNotMatch(review, /if \(!proofReview \|\| dualRoleChoice\)/);
  assert.match(review, /const choosingDualRole = Boolean\(dualRoleChoice\)/);
  assert.match(review, /choosingDualRole\s*\? dualRoleChoiceControls\(\)/);
  assert.match(review, /choosingDualRole\s*\?\s*''\s*:/);
  assert.match(css, /\.proof-role-step\{[^}]*animation:proof-role-step-in/);
  assert.match(css, /@keyframes proof-role-step-in\{[^}]*translateX/);
  assert.match(css, /prefers-reduced-motion:reduce[^]*\.proof-role-step\{animation:none/);
});

test('dual proof state supports Main-first and Selfie-first capture order', async () => {
  const dual = await import('../src/dual-proof.js');
  assert.equal(typeof dual.setDualProofFile, 'function');
  const first = new File([new Uint8Array([1])], 'first.jpg', { type: 'image/jpeg' });
  const second = new File([new Uint8Array([2])], 'second.jpg', { type: 'image/jpeg' });

  let mainFirst = dual.createDualProofState('habit', first, 'main');
  assert.equal(mainFirst.mainFile, first);
  assert.equal(mainFirst.selfieFile, null);
  mainFirst = dual.setDualProofFile(mainFirst, 'selfie', second);
  assert.equal(mainFirst.mainFile, first);
  assert.equal(mainFirst.selfieFile, second);

  let selfieFirst = dual.createDualProofState('habit', first, 'selfie');
  assert.equal(selfieFirst.selfieFile, first);
  assert.equal(selfieFirst.mainFile, null);
  selfieFirst = dual.setDualProofFile(selfieFirst, 'main', second);
  assert.equal(selfieFirst.mainFile, second);
  assert.equal(selfieFirst.selfieFile, first);
});

test('second native capture cancellation preserves the existing single-photo review', () => {
  const handler = section(app, 'async function handleNativeDualInput(', 'function bindProofActions()');
  assert.match(handler, /if \(!file\) return false/);
  assert.doesNotMatch(handler, /if \(!file\)[\s\S]{0,120}clearProofReview/);
  assert.match(handler, /proofReview/);
});
