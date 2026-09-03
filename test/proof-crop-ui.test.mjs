import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('tall proofs use a fixed 3:4 crop sheet before upload', () => {
  assert.match(app, /let proofCrop = null/);
  assert.match(app, /inspectProofFile/);
  assert.match(app, /cropProofFile/);
  const sheet = section(app, 'function proofCropSheet()', 'function dualRoleChoiceSheet()');
  assert.match(sheet, /data-proof-crop-frame/);
  assert.match(sheet, /data-proof-crop-image/);
  assert.match(sheet, /data-proof-crop-use[^>]*>Use crop/);
  assert.match(sheet, /data-proof-crop-cancel[^>]*>Cancel/);
  assert.match(social, /\.proof-crop-frame\{[^}]*aspect-ratio:3\/4[^}]*overflow:hidden/);
  assert.match(social, /\.proof-crop-image\{[^}]*object-fit:cover[^}]*object-position:/);
});

test('crop drag stays local and updates normalized vertical position', () => {
  const bind = section(app, 'function bindProofCropActions()', 'function bindProofActions()');
  assert.match(bind, /pointerdown/);
  assert.match(bind, /pointermove/);
  assert.match(bind, /Math\.max\(0, Math\.min\(1,/);
  assert.match(bind, /objectPosition/);
  assert.doesNotMatch(bind, /completeWithProof/);
});

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

test('crop confirmation passes only the final cropped or recomposed artifact to upload', () => {
  const useCrop = section(app, 'async function handleUseProofCrop()', 'function dualRoleChoiceSheet()');
  assert.match(useCrop, /cropProofFile\(crop\.sourceFile, crop\.position\)/);
  assert.match(useCrop, /crop\.dual[^]*composeDualProof\(cropped, crop\.selfieFile\)/);
  assert.match(useCrop, /uploadProofArtifact\(crop\.review, artifact\)/);
  assert.doesNotMatch(useCrop, /completeWithProof/);
  const upload = section(app, 'async function uploadProofArtifact(', 'async function handleProofSubmit()');
  assert.equal((upload.match(/completeWithProof/g) || []).length, 1);
});

test('cropped single proofs are compressed and validated before centralized upload', () => {
  const useCrop = section(app, 'async function handleUseProofCrop()', 'function dualRoleChoiceSheet()');
  assert.match(useCrop, /cropped\.size > MAX_PROOF_BYTES[^]*compressProofFile\(cropped\)/);
  assert.match(useCrop, /validateProofFile\(artifact\)/);
  assert.ok(useCrop.indexOf('validateProofFile(artifact)') < useCrop.indexOf('uploadProofArtifact(crop.review, artifact)'));
});

test('crop cancel returns to review without uploading anything', () => {
  const cancel = section(app, 'function closeProofCrop()', 'async function handleUseProofCrop()');
  assert.match(cancel, /proofCrop = null/);
  assert.match(cancel, /URL\.revokeObjectURL/);
  assert.doesNotMatch(cancel, /completeWithProof|uploadProofArtifact/);
});
