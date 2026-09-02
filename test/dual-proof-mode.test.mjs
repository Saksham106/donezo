import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiresPhotoProof } from '../src/proof.js';
import { mapDatabaseState, validateHabitInput } from '../src/store.js';

const storeSource = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

test('photo is the only proof-required habit mode', () => {
  assert.equal(requiresPhotoProof('none'), false);
  assert.equal(requiresPhotoProof('photo'), true);
  assert.equal(requiresPhotoProof('dual_photo'), false);
  assert.equal(validateHabitInput({ title: 'Gym', emoji: '🏋️', targetTime: '18:00', proofMode: 'photo' }).proofMode, 'photo');
  assert.throws(() => validateHabitInput({ title: 'Gym', emoji: '🏋️', targetTime: '18:00', proofMode: 'dual_photo' }), /valid proof mode/);
});

test('simple check-in paths reject every proof-required habit mode', () => {
  assert.match(storeSource, /toggleSimpleCheckIn[\s\S]*requiresPhotoProof\(habit\.proofMode\)/);
});

test('database state exposes the private updates high-water mark', () => {
  const state = mapDatabaseState({ id: 'me', email: 'me@example.com' }, {
    profile: { id: 'me', display_name: 'Me', timezone: 'UTC' },
    userUpdateState: { last_seen_at: '2026-09-02T18:00:00Z' },
  });
  assert.equal(state.updatesLastSeenAt, '2026-09-02T18:00:00Z');
});

test('repository loads and marks Updates through the dedicated state/RPC contract', () => {
  assert.match(storeSource, /from\('user_update_state'\)\.select\('last_seen_at'\)/);
  assert.match(storeSource, /async function markUpdatesSeen\(\)/);
  assert.match(storeSource, /rpc\('mark_updates_seen'\)/);
  assert.match(storeSource, /applyUpdatesSeen/);
});
