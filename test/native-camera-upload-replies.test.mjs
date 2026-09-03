import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const migrationUrl = new URL('../supabase/migrations/20260902_fix_selected_friend_proof_snapshot.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('native phone camera is the primary Take photo path with no Donezo camera option', () => {
  const picker = section(app, 'function proofSourceSheet()', 'function proofReviewSheet()');
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.match(picker, /data-proof-camera[^>]*>Take photo/);
  assert.doesNotMatch(picker, /data-proof-donezo-camera|Use Donezo camera/);
  assert.match(bindings, /\[data-proof-camera\][^]*chooseProofInput\(proofInput\)/);
  assert.doesNotMatch(bindings, /data-proof-donezo-camera|getUserMedia/);
});

test('a native single photo can be upgraded to Dual in either role', () => {
  const review = section(app, 'function proofReviewSheet()', 'function clearDualProof()');
  const role = section(app, 'function dualRoleChoiceControls()', 'function proofSourceSheet()');
  const bindings = section(app, 'function bindProofActions()', 'async function openFriendProfile(');
  assert.match(review, /data-proof-make-dual/);
  assert.match(review, /Make Dual/);
  assert.match(role, /Main proof/);
  assert.match(role, /Selfie/);
  assert.match(bindings, /createDualProofState\(habitId, firstFile, role\)/);
  assert.match(bindings, /role === 'main' \? proofSelfieInput : dualProofMainInput/);
});

test('cancelling the native second photo keeps the single-photo review usable', () => {
  const handler = section(app, 'async function handleNativeDualInput(', 'function bindProofActions()');
  assert.match(handler, /if \(!file\) return false/);
  assert.doesNotMatch(handler, /if \(!file\)[\s\S]{0,120}clearProofReview/);
  assert.match(handler, /proofReview/);
});

test('Friends heading removes the redundant Your People eyebrow', () => {
  const friends = section(app, 'function friendsScreen()', 'function challengeProgress');
  assert.doesNotMatch(friends, /YOUR PEOPLE/i);
  assert.match(friends, /<h1>Friends<\/h1>|>Friends<\/h1>/);
});

test('opening replies mounts an overlay without rebuilding the Friends feed', () => {
  const renderBindings = section(app, "app.querySelectorAll('[data-comment-open]')", "app.querySelectorAll('[data-delete-comment]')");
  assert.match(renderBindings, /openCommentSheet\(/);
  assert.doesNotMatch(renderBindings, /render\(/);
  const mount = section(app, 'function openCommentSheet(', 'async function handleCommentSubmit');
  assert.match(mount, /insertAdjacentHTML\(['\"]beforeend['\"],\s*commentSheet\(\)\)/);
  assert.match(mount, /bindCommentSheetActions\(\)/);
});

test('selected-friends proof snapshot avoids ambiguous viewer identifiers', () => {
  assert.match(migration, /create or replace function private\.snapshot_check_in_audience_members\(\)/i);
  assert.doesNotMatch(migration, /\bviewer\s+uuid\s*;/i);
  assert.doesNotMatch(migration, /selected\s*\(viewer\)/i);
  assert.match(migration, /selected_viewer_id/i);
  assert.match(migration, /private\.are_direct_friends\(habit\.owner_id,\s*selected_viewer_id\)/i);
});
