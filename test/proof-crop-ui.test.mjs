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
  const sheet = section(app, 'function proofCropSheet()', 'function dualRoleChoiceControls()');
  assert.match(sheet, /data-proof-crop-frame/);
  assert.match(sheet, /data-proof-crop-image/);
  assert.match(sheet, /data-proof-crop-use[^>]*>Use crop/);
  assert.match(sheet, /data-proof-crop-cancel[^>]*>Cancel/);
  assert.match(social, /\.proof-crop-stage\{[^}]*overflow:hidden/);
  assert.match(social, /\.proof-crop-window\{[^}]*height:calc\(var\(--proof-crop-window-height\) \* 1%\)/);
});

test('crop step replaces proof review instead of stacking behind it', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  const crop = section(app, 'function proofCropSheet()', 'function openProofCrop(');
  assert.match(review, /if \(!proofReview \|\| proofCrop\) return '';/);
  assert.match(crop, /role="dialog"[^>]*aria-label="Crop proof"/);
  assert.match(crop, /data-swipe-dismiss="false"/);
});

test('crop preview shows the whole photo with a clear dimmed crop window', () => {
  const crop = section(app, 'function proofCropSheet()', 'function openProofCrop(');
  assert.match(crop, /proof-crop-stage/);
  assert.match(crop, /data-proof-crop-window/);
  assert.match(crop, /--proof-crop-window-top:/);
  assert.match(crop, /--proof-crop-window-height:/);
  assert.match(social, /\.proof-crop-stage\{[^}]*position:relative/);
  assert.match(social, /\.proof-crop-image\{[^}]*object-fit:contain/);
  assert.match(social, /\.proof-crop-window\{[^}]*box-shadow:[^}]*9999px/);
  assert.match(social, /\.proof-crop-window\{[^}]*border:3px solid var\(--color-coral\)/);
  assert.match(social, /\.proof-crop-stage\{[^}]*max-height:min\(42dvh,26rem\)/);
  assert.match(social, /\.proof-crop-sheet\{[^}]*overflow-y:auto/);
  assert.match(crop, /role="slider"/);
  assert.match(crop, /tabindex="0"/);
  assert.match(crop, /aria-label="Vertical crop position"/);
});

test('crop drag stays local and updates normalized vertical position', () => {
  const bind = section(app, 'function bindProofCropActions()', 'function bindProofActions()');
  assert.match(bind, /pointerdown/);
  assert.match(bind, /pointermove/);
  assert.match(bind, /Math\.max\(0, Math\.min\(1,/);
  assert.match(bind, /style\.setProperty\('--proof-crop-window-top'/);
  assert.match(bind, /--proof-crop-window-top/);
  assert.doesNotMatch(bind, /completeWithProof/);
});

test('crop position supports keyboard and assistive technology', () => {
  const bind = section(app, 'function bindProofCropActions()', 'function bindProofActions()');
  assert.match(bind, /keydown/);
  assert.match(bind, /ArrowUp/);
  assert.match(bind, /ArrowDown/);
  assert.match(bind, /aria-valuenow/);
  assert.match(social, /\.proof-crop-canvas \.proof-crop-window:focus-visible\{[^}]*outline:4px solid var\(--color-white\)[^}]*outline-offset:-7px/);
  assert.match(social, /\.proof-crop-window:focus-visible/);
});

test('crop gestures cannot trigger generic sheet swipe dismissal', () => {
  const swipe = section(app, 'function bindSheetSwipeDismiss()', 'function closeSheets()');
  assert.match(swipe, /sheet\.dataset\.swipeDismiss === 'false'/);
  const crop = section(app, 'function proofCropSheet()', 'function openProofCrop(');
  assert.match(crop, /data-swipe-dismiss="false"/);
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
  const useCrop = section(app, 'async function handleUseProofCrop()', 'function dualRoleChoiceControls()');
  assert.match(useCrop, /cropProofFile\(crop\.sourceFile, crop\.position\)/);
  assert.match(useCrop, /crop\.dual[^]*composeDualProof\(cropped, crop\.selfieFile\)/);
  assert.match(useCrop, /uploadProofArtifact\(crop\.review, artifact\)/);
  assert.doesNotMatch(useCrop, /completeWithProof/);
  const upload = section(app, 'async function uploadProofArtifact(', 'async function handleProofSubmit()');
  assert.equal((upload.match(/completeWithProof/g) || []).length, 1);
});

test('cropped single proofs are compressed and validated before centralized upload', () => {
  const useCrop = section(app, 'async function handleUseProofCrop()', 'function dualRoleChoiceControls()');
  assert.match(useCrop, /cropped\.size > MAX_PROOF_BYTES[^]*compressProofFile\(cropped\)/);
  assert.match(useCrop, /validateProofFile\(artifact\)/);
  assert.ok(useCrop.indexOf('proofCrop = null') < useCrop.indexOf('uploadProofArtifact(crop.review, artifact)'));
});

test('cancelling during asynchronous crop work invalidates the pending upload', () => {
  const open = section(app, 'function openProofCrop(', 'function closeProofCrop()');
  const close = section(app, 'function closeProofCrop()', 'async function handleUseProofCrop()');
  const useCrop = section(app, 'async function handleUseProofCrop()', 'function dualRoleChoiceControls()');
  assert.match(open, /proofCropOperationId \+= 1/);
  assert.match(close, /proofCropOperationId \+= 1/);
  assert.match(useCrop, /const operationId = \+\+proofCropOperationId/);
  assert.match(useCrop, /operationId !== proofCropOperationId \|\| proofCrop !== crop/);
  assert.match(useCrop, /catch \(error\) \{\s*if \(operationId !== proofCropOperationId \|\| proofCrop !== crop\) return;/);
  const uploadIndex = useCrop.indexOf('uploadProofArtifact(crop.review, artifact)');
  const guardsBeforeUpload = [...useCrop.matchAll(/operationId !== proofCropOperationId \|\| proofCrop !== crop/g)]
    .filter((match) => match.index < uploadIndex);
  assert.equal(guardsBeforeUpload.length, 2);
});

test('crop cancel restores the exact review without uploading anything', () => {
  const cancel = section(app, 'function closeProofCrop()', 'async function handleUseProofCrop()');
  assert.match(cancel, /const crop = proofCrop/);
  assert.match(cancel, /proofReview = crop\.review/);
  assert.match(cancel, /proofCrop = null/);
  assert.match(cancel, /URL\.revokeObjectURL/);
  assert.doesNotMatch(cancel, /completeWithProof|uploadProofArtifact/);
});
