import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const css = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('single proof review uses one compact Choose another and Make Dual row', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(review, /data-proof-choose[^>]*>Choose another/);
  assert.match(review, /data-proof-make-dual[^>]*>Make Dual/);
  assert.match(review, /compact-proof-review-actions/);
  assert.match(review, /proof-make-dual/);
  assert.doesNotMatch(review, />Retake(?: proof| selfie)?</);
  assert.match(css, /\.proof-make-dual[^}]*background:/);
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
