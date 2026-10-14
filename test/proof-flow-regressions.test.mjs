import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { cropGeometry } from '../src/proof-crop.js';

const source = readFileSync(new URL('../src/ui/checkin.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const file = (name = 'photo', size = 10) => ({ name, size });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(overrides = {}) {
  const habit = { id: 'h', title: 'Read', emoji: 'R', proofMode: 'photo' };
  const review = { habitId: 'h', file: file(), previewUrl: 'blob:review', status: 'ready' };
  const ui = { proofReview: review, proofCrop: null, proofPreparationId: 0, busy: false };
  const uploads = [], notifications = [], revoked = [];
  const context = {
    ui, inputs: {}, app: { querySelector: () => null }, getState: () => ({ habits: [habit], currentUserId: 'u' }),
    today: () => '2026-10-13', me: () => ({ id: 'u' }), checkInFor: () => null,
    completedHabitsFor: () => [habit], actionableHabitsFor: () => [], missedHabits: () => [], sortHabitsForDay: (rows) => rows,
    esc: String, icon: () => '', render: () => {}, renderPreservingScroll: () => {}, haptic: () => {},
    notify: (message) => notifications.push(message), readableError: (error) => error.message,
    MAX_PROOF_BYTES: 100, validateProofFile: () => ({ valid: true }), formatProofFileSize: String,
    createProofReviewState: (value) => ({ ...value, status: 'ready' }),
    setDualProofFile: (dual, role, value) => ({ ...dual, [`${role}File`]: value }),
    cropGeometry, cropProofFile: async () => file('cropped'), compressProofFile: async (value) => value,
    composeDualProof: async (main) => file(main.name + '-dual'),
    URL: { createObjectURL: (value) => `blob:${value.name}`, revokeObjectURL: (url) => revoked.push(url) },
    ...overrides,
  };
  ui.repo = { completeWithProof: async (...args) => uploads.push(args) };
  const flow = runInNewContext(`${source}\n({checkInSheets, openProofCrop, closeProofCrop, handleUseProofCrop, resetProofFlow, handleNativeDualInput, bindProofCropActions, bindCheckIn, openCheckIn})`, context);
  return { flow, ui, review, habit, uploads, notifications, revoked };
}

test('crop is the sole proof dialog and cannot participate in sheet swipe', () => {
  const { flow, review } = setup();
  flow.openProofCrop(review, review.file, { width: 600, height: 1600 });
  const html = flow.checkInSheets();
  assert.equal((html.match(/role="dialog"/g) || []).length, 1);
  assert.match(html, /data-no-swipe="true"/);
});

test('portrait window and dragging select the same geometry as uploaded crop, including position zero', () => {
  const { flow, ui, review } = setup();
  flow.openProofCrop(review, review.file, { width: 600, height: 1600 });
  ui.proofCrop.position = 0;
  const html = flow.checkInSheets();
  assert.match(html, /aspect-ratio:600\/1600/);
  assert.match(html, /--proof-crop-window-height:50(?:\.0+)?/);
  assert.match(html, /--proof-crop-window-top:0(?:\.0+)?/);
  const events = {}, properties = {};
  const frame = { clientHeight: 400, addEventListener: (name, fn) => { events[name] = fn; }, style: { setProperty: (key, value) => { properties[key] = value; } } };
  const image = { style: {} }, window = { setAttribute() {}, addEventListener() {} };
  const root = { querySelectorAll: () => [], querySelector: (selector) => ({ '[data-proof-crop-frame]': frame, '[data-proof-crop-image]': image, '[data-proof-crop-window]': window }[selector]) };
  flow.bindProofCropActions(root);
  events.pointerdown({ clientY: 0, preventDefault() {} });
  events.pointermove({ clientY: 100 });
  assert.equal(ui.proofCrop.position, 0.5);
  assert.equal(Number(properties['--proof-crop-window-top']), 25);
  assert.equal(cropGeometry(600, 1600, ui.proofCrop.position).sourceY, 400);
});

for (const stage of ['crop', 'compose', 'compress']) {
  test(`cancel/reset during ${stage} never uploads or resurrects review`, async () => {
    const pending = deferred();
    const { flow, ui, review, uploads, notifications } = setup({
      cropProofFile: stage === 'crop' ? () => pending.promise : async () => file('crop', stage === 'compress' ? 200 : 10),
      composeDualProof: () => pending.promise, compressProofFile: () => pending.promise,
    });
    flow.openProofCrop(review, review.file, { dual: stage === 'compose', selfieFile: file('selfie') });
    const work = flow.handleUseProofCrop();
    await Promise.resolve();
    flow.resetProofFlow();
    pending.resolve(file('result'));
    await work;
    assert.equal(uploads.length, 0);
    assert.equal(ui.proofReview, null);
    assert.equal(ui.proofCrop, null);
    assert.equal(notifications.length, 0);
  });
}

test('cancel crop preserves original review and makes late crop failure silent', async () => {
  const pending = deferred();
  const { flow, ui, review, notifications } = setup({ cropProofFile: () => pending.promise });
  flow.openProofCrop(review, review.file);
  const work = flow.handleUseProofCrop();
  flow.closeProofCrop();
  pending.reject(new Error('late crop failure'));
  await work;
  assert.equal(ui.proofReview, review);
  assert.equal(notifications.length, 0);
});

for (const stage of ['compression', 'composition']) {
  test(`reset during dual ${stage} cannot resurrect the canceled proof flow`, async () => {
    const pending = deferred();
    const { flow, ui, notifications } = setup({ compressProofFile: () => pending.promise, composeDualProof: () => pending.promise });
    ui.dualProof = { habitId: 'h', mainFile: file('main'), selfieFile: file('selfie') };
    const work = flow.handleNativeDualInput({ files: [file('replacement', stage === 'compression' ? 200 : 10)] }, 'main');
    await Promise.resolve();
    flow.resetProofFlow();
    pending.resolve(file('stale'));
    assert.equal(await work, false);
    assert.equal(ui.proofReview, null);
    assert.equal(ui.dualProof, null);
    assert.equal(notifications.length, 0);
  });
}

test('new dual selection wins when older compression completes later', async () => {
  const pending = deferred();
  const { flow, ui } = setup({ compressProofFile: () => pending.promise });
  ui.dualProof = { habitId: 'h', mainFile: file('main'), selfieFile: file('selfie') };
  const older = flow.handleNativeDualInput({ files: [file('old', 200)] }, 'main');
  assert.equal(await flow.handleNativeDualInput({ files: [file('new')] }, 'main'), true);
  const newerReview = ui.proofReview, newerDual = ui.dualProof;
  pending.resolve(file('old-compressed'));
  assert.equal(await older, false);
  assert.equal(ui.proofReview, newerReview);
  assert.equal(ui.dualProof, newerDual);
});

test('new dual selection wins when older composition completes later', async () => {
  const pending = deferred();
  const { flow, ui } = setup({ composeDualProof: (main) => main.name === 'old' ? pending.promise : Promise.resolve(file('new-dual')) });
  ui.dualProof = { habitId: 'h', mainFile: file('main'), selfieFile: file('selfie') };
  const older = flow.handleNativeDualInput({ files: [file('old')] }, 'main');
  await Promise.resolve();
  assert.equal(await flow.handleNativeDualInput({ files: [file('new')] }, 'main'), true);
  const newerReview = ui.proofReview, newerDual = ui.dualProof;
  pending.resolve(file('old-dual'));
  assert.equal(await older, false);
  assert.equal(ui.proofReview, newerReview);
  assert.equal(ui.dualProof, newerDual);
});

test('caught-up keeps completed-today Undo available and opens confirmation through its bound control', async () => {
  const { flow, ui, habit } = setup({ checkInFor: () => ({ id: 'checkin' }) });
  flow.resetProofFlow();
  flow.openCheckIn();
  assert.equal(ui.checkInOverlay, 'caught-up');
  const html = flow.checkInSheets();
  assert.match(html, /data-habit="h"[^>]*aria-label="Undo Read"/);
  const undo = { dataset: { habit: 'h' } };
  const root = { querySelectorAll: (selector) => selector === '[data-habit]' ? [undo] : [], querySelector: () => null };
  flow.bindCheckIn(root);
  await undo.onclick();
  assert.equal(ui.checkInUndoRequest.habitId, habit.id);
  assert.equal(ui.checkInUndoRequest.date, '2026-10-13');
  assert.match(flow.checkInSheets(), /role="alertdialog"/);
});

test('crop preview uses the encoder rounded pixel height for odd-sized portraits', () => {
  const { flow, review } = setup();
  flow.openProofCrop(review, review.file, { width: 601, height: 1601 });
  const expected = (cropGeometry(601, 1601).sourceHeight / 1601 * 100).toFixed(3);
  assert.ok(flow.checkInSheets().includes(`--proof-crop-window-height:${expected}`));
});

test('active crop uploads exactly the finalized artifact with the chosen top position', async () => {
  const artifact = file('final-crop');
  let selectedPosition;
  const { flow, ui, review, uploads } = setup({ cropProofFile: async (_file, position) => { selectedPosition = position; return artifact; } });
  flow.openProofCrop(review, review.file, { width: 600, height: 1600 });
  ui.proofCrop.position = 0;
  await flow.handleUseProofCrop();
  assert.equal(selectedPosition, 0);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][0], 'h');
  assert.equal(uploads[0][2], artifact);
  assert.equal(ui.proofCrop, null);
  assert.equal(ui.proofReview, null);
});

test('two Use crop taps cannot post two completions', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const { flow, review, uploads } = setup({ cropProofFile: () => (++calls === 1 ? first.promise : second.promise) });
  flow.openProofCrop(review, review.file);
  const older = flow.handleUseProofCrop(), newer = flow.handleUseProofCrop();
  second.resolve(file('newer'));
  await newer;
  first.resolve(file('older'));
  await older;
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][2].name, 'newer');
});
