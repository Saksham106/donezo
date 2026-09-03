import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDualProofState,
  setDualProofFile,
  compositionGeometry,
  composeDualProof,
} from '../src/dual-proof.js';

test('dual proof state preserves the opposite capture when replacing either role', () => {
  const main = { name: 'main.jpg' };
  const selfie = { name: 'selfie.jpg' };
  const nextMain = { name: 'main-2.jpg' };
  const nextSelfie = { name: 'selfie-2.jpg' };

  let state = createDualProofState('habit-1', main, 'main');
  assert.equal(state.mainFile, main);
  assert.equal(state.selfieFile, null);
  assert.equal(state.firstRole, 'main');

  state = setDualProofFile(state, 'selfie', selfie);
  assert.equal(state.mainFile, main);
  assert.equal(state.selfieFile, selfie);

  const replaceMain = setDualProofFile(state, 'main', nextMain);
  assert.equal(replaceMain.mainFile, nextMain);
  assert.equal(replaceMain.selfieFile, selfie);

  const replaceSelfie = setDualProofFile(state, 'selfie', nextSelfie);
  assert.equal(replaceSelfie.mainFile, main);
  assert.equal(replaceSelfie.selfieFile, nextSelfie);
});

test('dual proof can start with the selfie and later receive the main proof', () => {
  const selfie = { name: 'selfie.jpg' };
  const main = { name: 'main.jpg' };
  let state = createDualProofState('habit-1', selfie, 'selfie');
  assert.equal(state.mainFile, null);
  assert.equal(state.selfieFile, selfie);
  assert.equal(state.firstRole, 'selfie');
  state = setDualProofFile(state, 'main', main);
  assert.equal(state.mainFile, main);
  assert.equal(state.selfieFile, selfie);
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
