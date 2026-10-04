import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDualProofState, setDualProofFile } from '../src/dual-proof.js';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
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
