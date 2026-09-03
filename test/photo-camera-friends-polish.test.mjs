import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDualProofState, setDualProofFile } from '../src/dual-proof.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const proof = readFileSync(new URL('../src/proof.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('habit proof mode is only Photo proof or Truuust me', () => {
  const habit = section(app, 'function habitSheet()', 'function settingsSheet()');
  assert.match(habit, /value="photo"/);
  assert.match(habit, /value="none"/);
  assert.doesNotMatch(habit, /value="dual_photo"/);

  const validation = section(store, 'export function validateHabitInput', 'export function proofObjectPath');
  assert.match(validation, /\['photo', 'none'\]/);
  assert.doesNotMatch(validation, /dual_photo/);

  const requirement = section(proof, 'export function requiresPhotoProof', 'const PROOF_TYPE_ALIASES');
  assert.match(requirement, /mode === 'photo'/);
  assert.doesNotMatch(requirement, /dual_photo/);
});

test('Dual is a native review upgrade rather than a separate proof source', () => {
  const source = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  assert.match(source, /data-proof-camera[^>]*>Take photo/);
  assert.doesNotMatch(source, /data-proof-dual|Dual photo|Use Donezo camera/);

  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  assert.match(review, /data-proof-make-dual[^>]*>Make Dual/);
  const role = section(app, 'function dualRoleChoiceSheet()', 'function proofSourceSheet()');
  assert.match(role, /Main proof/);
  assert.match(role, /Selfie/);
});

test('native Dual state supports either first-photo role', () => {
  const main = { name: 'main.jpg' };
  const selfie = { name: 'selfie.jpg' };
  let mainFirst = createDualProofState('habit-1', main, 'main');
  assert.equal(mainFirst.mainFile, main);
  assert.equal(mainFirst.selfieFile, null);
  mainFirst = setDualProofFile(mainFirst, 'selfie', selfie);
  assert.equal(mainFirst.selfieFile, selfie);

  let selfieFirst = createDualProofState('habit-1', selfie, 'selfie');
  assert.equal(selfieFirst.selfieFile, selfie);
  assert.equal(selfieFirst.mainFile, null);
  selfieFirst = setDualProofFile(selfieFirst, 'main', main);
  assert.equal(selfieFirst.mainFile, main);
});

test('proof capture no longer uses a permission-heavy live camera stream', () => {
  assert.doesNotMatch(app, /getUserMedia|startDualCameraIfNeeded|captureVideoFrame|Use iPhone camera for better quality/);
  assert.doesNotMatch(social, /\.camera-quality-fallback|\.dual-camera-frame|\.camera-mode-switch/);
  assert.match(app, /role === 'main' \? proofSelfieInput : dualProofMainInput/);
});

test('Friends heading keeps refresh and people actions on one compact row', () => {
  const friends = section(app, 'function friendsScreen()', 'function challengeProgress');
  assert.match(friends, /friends-heading-row/);
  assert.match(friends, /data-manual-refresh/);
  assert.match(friends, /data-people-open/);
  assert.doesNotMatch(friends, /syncText/);
  assert.doesNotMatch(friends, /squad-refresh-row/);
  assert.doesNotMatch(friends, /Synced /);
  assert.match(app, /Synced just now/);
});

test('Friends proof feed cannot expand the PWA beyond the viewport', () => {
  assert.match(social, /\.activity-list\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(social, /\.activity\{[^}]*min-width:0/);
  assert.match(social, /\.activity-social-actions\{[^}]*min-width:0/);
  assert.match(social, /\.reaction-row\{[^}]*min-width:0[^}]*max-width:100%/);
});

test('database proof-mode constraint is returned to photo or none only', () => {
  const migrationUrl = new URL('../supabase/migrations/20260902_photo_camera_mode_cleanup.sql', import.meta.url);
  const migrationPath = fileURLToPath(migrationUrl);
  assert.equal(existsSync(migrationPath), true, 'photo camera cleanup migration must exist');
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(migration, /proof_mode in \('none', 'photo'\)/i);
  assert.doesNotMatch(migration, /proof_mode in \([^)]*dual_photo/i);
});
