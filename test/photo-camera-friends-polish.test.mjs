import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDualProofState, transitionDualProof } from '../src/dual-proof.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const proof = readFileSync(new URL('../src/proof.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');
const dualProof = readFileSync(new URL('../src/dual-proof.js', import.meta.url), 'utf8');

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

test('single and dual are camera modes inside Take photo', () => {
  const source = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  assert.match(source, /data-proof-camera[^>]*>Take photo/);
  assert.doesNotMatch(source, /data-proof-dual/);
  assert.doesNotMatch(source, />Dual photo<\/button>/);

  const camera = section(app, 'function dualProofSheet()', 'function proofSourceSheet()');
  assert.match(camera, /data-camera-mode="single"/);
  assert.match(camera, /data-camera-mode="dual"/);
  assert.match(camera, />Single</);
  assert.match(camera, />Dual</);

  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.match(bindings, /\[data-proof-camera\][^]*createDualProofState\(proofHabit, 'single'\)/);
});

test('camera state finishes after one photo in single mode and asks for selfie in dual mode', () => {
  const main = { name: 'main.jpg' };
  let single = createDualProofState('habit-1', 'single');
  assert.equal(single.mode, 'single');
  single = transitionDualProof(single, { type: 'main_selected', file: main });
  assert.equal(single.phase, 'review');

  let dual = createDualProofState('habit-1', 'dual');
  assert.equal(dual.mode, 'dual');
  dual = transitionDualProof(dual, { type: 'main_selected', file: main });
  assert.equal(dual.phase, 'selfie');
});

test('in-app camera asks for a higher quality stream and makes iPhone quality fallback prominent', () => {
  assert.match(app, /width:\s*\{\s*ideal:\s*1920\s*\}/);
  assert.match(app, /height:\s*\{\s*ideal:\s*1440\s*\}/);
  assert.match(dualProof, /quality = 0\.92/);
  assert.match(app, /Use iPhone camera for better quality/);
  assert.match(app, /camera-quality-fallback/);
  assert.match(social, /\.camera-quality-fallback\{/);
});

test('native iPhone camera handoff releases and restores the Donezo stream', () => {
  assert.match(app, /function openNativeCameraFallback\(input\)/);
  assert.match(app, /function openNativeCameraFallback\(input\)[^]*stopDualCamera\(\)[^]*input\?\.click\(\)/);
  assert.match(app, /visibilitychange[^]*document\.visibilityState !== 'visible'[^]*return;[^]*startDualCameraIfNeeded\(\)/);
  assert.match(app, /data-dual-fallback-main[^]*openNativeCameraFallback\(dualProofMainInput\)/);
  assert.match(app, /data-dual-fallback-selfie[^]*openNativeCameraFallback\(proofSelfieInput\)/);
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
