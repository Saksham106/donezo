import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const cropUrl = new URL('../src/proof-crop.js', import.meta.url);

async function cropModule() {
  assert.ok(existsSync(cropUrl), 'src/proof-crop.js must exist');
  return import(cropUrl.href);
}

test('crop is required only beyond 3:4 portrait height', async () => {
  const { needsProofCrop } = await cropModule();
  assert.equal(needsProofCrop(1200, 1600), false);
  assert.equal(needsProofCrop(1200, 1599), false);
  assert.equal(needsProofCrop(1200, 2000), true);
  assert.equal(needsProofCrop(1600, 1200), false);
});

test('crop geometry clamps top middle and bottom positions', async () => {
  const { cropGeometry } = await cropModule();
  assert.deepEqual(cropGeometry(1200, 2400, 0), {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1200,
    sourceHeight: 1600,
    outputWidth: 1200,
    outputHeight: 1600,
  });
  assert.equal(cropGeometry(1200, 2400, 0.5).sourceY, 400);
  assert.equal(cropGeometry(1200, 2400, 1).sourceY, 800);
  assert.equal(cropGeometry(1200, 2400, 9).sourceY, 800);
  assert.equal(cropGeometry(1200, 2400, -2).sourceY, 0);
});

test('cropProofFile emits one JPEG from the selected source rectangle', async () => {
  const { cropProofFile } = await cropModule();
  const original = new File([new Uint8Array([1, 2, 3])], 'long-proof.png', {
    type: 'image/png',
    lastModified: 1234,
  });
  let receivedGeometry = null;
  let closed = false;
  const result = await cropProofFile(original, 0.75, {
    decodeImage: async () => ({ width: 1200, height: 2400, close: () => { closed = true; } }),
    encodeCrop: async ({ geometry }) => {
      receivedGeometry = geometry;
      return new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' });
    },
  });

  assert.equal(receivedGeometry.sourceY, 600);
  assert.equal(receivedGeometry.sourceWidth, 1200);
  assert.equal(receivedGeometry.sourceHeight, 1600);
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'long-proof-cropped.jpg');
  assert.equal(result.lastModified, 1234);
  assert.equal(closed, true);
});
