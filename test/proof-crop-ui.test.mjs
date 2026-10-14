import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

test('fresh submit inspects the main proof and pauses tall images before centralized upload', () => {
  const submit = section(app, 'async function handleProofSubmit()', 'async function loadProofThumbnail');
  assert.match(submit, /review\.artifactFinalized/);
  assert.match(submit, /uploadProofArtifact\(review, review\.file\)/);
  assert.ok(submit.indexOf('review.artifactFinalized') < submit.indexOf('inspectProofFile'));
  assert.doesNotMatch(submit, /completeWithProof/);
});

test('crop cancel returns to review without uploading anything', () => {
  const cancel = section(app, 'function closeProofCrop()', 'async function handleUseProofCrop()');
  const open = section(app, 'function openProofCrop(', 'function closeProofCrop()');
  const review = { habitId: 'habit-1', file: {}, previewUrl: 'blob:review' };
  const ui = { proofReview: review, proofCrop: null };
  const revoked = [];
  let renders = 0;
  const flow = runInNewContext(`${open}\n${cancel}\n({ openProofCrop, closeProofCrop })`, {
    ui, render: () => { renders += 1; },
    URL: { createObjectURL: () => 'blob:crop', revokeObjectURL: (url) => revoked.push(url) },
  });
  assert.equal(flow.openProofCrop(review, review.file), true);
  flow.closeProofCrop();
  assert.equal(ui.proofReview, review, 'original review remains available for retry');
  assert.equal(ui.proofCrop, null);
  assert.deepEqual(revoked, ['blob:crop'], 'only the crop preview is released');
  assert.equal(renders, 2);
  assert.doesNotMatch(cancel, /completeWithProof|uploadProofArtifact/);
});
