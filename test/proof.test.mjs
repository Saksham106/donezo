import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROOF_BYTES,
  createProofReviewState,
  formatProofFileSize,
  imageFileFromPasteData,
  readClipboardImage,
  transitionProofReview,
  validateProofFile,
} from '../src/proof.js';

const makeFile = (type = 'image/jpeg', size = 1024) => ({ type, size, name: 'proof.jpg' });

test('proof validation preserves current file types and 4 MB limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
    assert.deepEqual(validateProofFile(makeFile(type, MAX_PROOF_BYTES)), { valid: true, error: null });
  }
  assert.equal(validateProofFile(makeFile('image/gif')).valid, false);
  assert.match(validateProofFile(makeFile('image/gif')).error, /JPG, PNG, WebP, or HEIC/);
  assert.equal(validateProofFile(makeFile('image/jpeg', MAX_PROOF_BYTES + 1)).valid, false);
  assert.match(validateProofFile(makeFile('image/jpeg', MAX_PROOF_BYTES + 1)).error, /4 MB/);
  assert.equal(validateProofFile(makeFile('image/jpeg', 0)).valid, false);
  assert.match(validateProofFile(makeFile('image/jpeg', 0)).error, /empty/i);
});

test('proof file size feedback is concise and deterministic', () => {
  assert.equal(formatProofFileSize(512), '512 B');
  assert.equal(formatProofFileSize(1536), '1.5 KB');
  assert.equal(formatProofFileSize(2.5 * 1024 * 1024), '2.5 MB');
});

test('proof review state keeps the selected file through upload failure for retry', () => {
  const file = makeFile('image/png', 2 * 1024 * 1024);
  const ready = createProofReviewState({ file, habitId: 'habit-1', previewUrl: 'blob:proof-1' });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.file, file);
  assert.equal(ready.previewUrl, 'blob:proof-1');
  assert.equal(ready.error, null);

  const uploading = transitionProofReview(ready, { type: 'uploading' });
  assert.equal(uploading.status, 'uploading');

  const failed = transitionProofReview(uploading, { type: 'failed', error: 'Upload failed' });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'Upload failed');
  assert.equal(failed.file, file);
  assert.equal(failed.previewUrl, 'blob:proof-1');

  const retrying = transitionProofReview(failed, { type: 'uploading' });
  assert.equal(retrying.status, 'uploading');
  assert.equal(retrying.file, file);
});

test('selecting a replacement resets stale upload errors', () => {
  const first = createProofReviewState({ file: makeFile(), habitId: 'habit-1', previewUrl: 'blob:first' });
  const failed = transitionProofReview(first, { type: 'failed', error: 'Nope' });
  const replacement = makeFile('image/webp', 2048);
  const next = transitionProofReview(failed, { type: 'selected', file: replacement, habitId: 'habit-1', previewUrl: 'blob:second' });
  assert.equal(next.status, 'ready');
  assert.equal(next.error, null);
  assert.equal(next.file, replacement);
  assert.equal(next.previewUrl, 'blob:second');
});

test('clipboard image reading creates a named proof File and ignores non-images', async () => {
  const image = new Blob(['pixels'], { type: 'image/png' });
  const clipboard = {
    async read() {
      return [{ types: ['text/plain', 'image/png'], getType: async (type) => type === 'image/png' ? image : new Blob(['no']) }];
    },
  };
  const file = await readClipboardImage(clipboard);
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'pasted-proof.png');
  assert.equal(file.size, image.size);

  await assert.rejects(
    () => readClipboardImage({ read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['no']) }] }),
    /No photo found/i,
  );
});

test('paste event extraction accepts only image files', () => {
  const image = new File(['pixels'], 'shot.png', { type: 'image/png' });
  const text = new File(['words'], 'note.txt', { type: 'text/plain' });
  assert.equal(imageFileFromPasteData({ files: [text, image] }), image);
  assert.equal(imageFileFromPasteData({ files: [text] }), null);
});
