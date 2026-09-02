import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDualProofState,
  transitionDualProof,
  stopMediaStream,
  compositionGeometry,
  composeDualProof,
} from '../src/dual-proof.js';

test('dual proof state preserves the opposite capture during retakes and failures', () => {
  const main = { name: 'main.jpg' };
  const selfie = { name: 'selfie.jpg' };
  let state = createDualProofState('habit-1');
  assert.equal(state.phase, 'main');
  state = transitionDualProof(state, { type: 'main_selected', file: main });
  assert.equal(state.phase, 'selfie');
  state = transitionDualProof(state, { type: 'selfie_selected', file: selfie });
  assert.equal(state.phase, 'review');
  assert.equal(state.mainFile, main);
  assert.equal(state.selfieFile, selfie);

  const retakeMain = transitionDualProof(state, { type: 'retake_main' });
  assert.equal(retakeMain.phase, 'main');
  assert.equal(retakeMain.mainFile, null);
  assert.equal(retakeMain.selfieFile, selfie);

  const failed = transitionDualProof(state, { type: 'failed', error: 'camera died' });
  assert.equal(failed.mainFile, main);
  assert.equal(failed.selfieFile, selfie);
  assert.equal(failed.error, 'camera died');
});

test('stopMediaStream stops every active track', () => {
  const stopped = [];
  stopMediaStream({ getTracks: () => [{ stop: () => stopped.push(1) }, { stop: () => stopped.push(2) }] });
  assert.deepEqual(stopped, [1, 2]);
});

test('composition preserves the full main aspect ratio and uses a square top-right selfie inset', () => {
  const geometry = compositionGeometry({ width: 4000, height: 3000 }, { width: 1200, height: 1600 }, { maxDimension: 2000, insetRatio: 0.3, marginRatio: 0.03 });
  assert.deepEqual([geometry.width, geometry.height], [2000, 1500]);
  assert.equal(geometry.selfie.destWidth, geometry.selfie.destHeight);
  assert.equal(geometry.selfie.destWidth, 600);
  assert.equal(geometry.selfie.destX, 2000 - 600 - 60);
  assert.equal(geometry.selfie.destY, 60);
  assert.equal(geometry.selfie.sourceWidth, geometry.selfie.sourceHeight);
});

test('composeDualProof emits one JPEG File through the shared proof-compression path', async () => {
  const calls = [];
  const result = await composeDualProof(
    new File(['main'], 'main.jpg', { type: 'image/jpeg' }),
    new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' }),
    {
      decodeImage: async (file) => file.name === 'main.jpg'
        ? { width: 1600, height: 1200, close() {} }
        : { width: 900, height: 1200, close() {} },
      encodeComposite: async ({ geometry }) => {
        calls.push(geometry);
        return new Blob(['composite'], { type: 'image/jpeg' });
      },
      compressFile: async (file) => file,
      now: () => 123,
    },
  );
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'dual-proof-123.jpg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].width / calls[0].height, 4 / 3);
});
