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

test('fresh submit inspects the main proof and pauses tall images before centralized upload', () => {
  const submit = section(app, 'async function handleProofSubmit()', 'async function loadProofThumbnail');
  assert.match(submit, /dualProof\?\.habitId === review\.habitId[^]*dualProof\.mainFile/);
  assert.match(submit, /inspectProofFile\(cropSource\)/);
  assert.match(submit, /inspection\.needsCrop/);
  assert.match(submit, /openProofCrop\(/);
  assert.match(submit, /uploadProofArtifact\(review, review\.file\)/);
  assert.doesNotMatch(submit, /completeWithProof/);
  const freshUpload = submit.lastIndexOf('uploadProofArtifact(review, review.file)');
  assert.ok(freshUpload > submit.indexOf('inspection.needsCrop'));
});

test('crop cancel returns to review without uploading anything', () => {
  const cancel = section(app, 'function closeProofCrop()', 'async function handleUseProofCrop()');
  assert.match(cancel, /proofCrop = null/);
  assert.match(cancel, /URL\.revokeObjectURL/);
  assert.doesNotMatch(cancel, /completeWithProof|uploadProofArtifact/);
});
