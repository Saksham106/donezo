import { readFile, writeFile } from 'node:fs/promises';

const storePath = 'src/store.js';
const appPath = 'src/app.js';
const runnerPath = 'scripts/apply-fluid-performance.mjs';
const original = await readFile(storePath, 'utf8');
const completeStart = original.indexOf('  async function completeWithProof(habitId, date, file) {');
const downvoteStart = original.indexOf('  async function toggleDownvote(checkInId) {', completeStart);
if (completeStart < 0 || downvoteStart < 0) throw new Error('Could not snapshot completeWithProof');
const completeWithProof = original.slice(completeStart, downvoteStart);

let runner = await readFile(runnerPath, 'utf8');
runner = runner.replace(
  'notify(`Could not refresh. Showing your last good sync. \\${readableError(error)}`, 4200);',
  "notify('Could not refresh. Showing your last good sync. ' + readableError(error), 4200);",
);
await writeFile(runnerPath, runner);
await import('./apply-fluid-performance.mjs');

// Preserve the pre-existing draft-safety contract exactly: refresh data may
// be cached after the mounted draft is protected, never between the state
// timestamp and the draft-preserving render decision.
let app = await readFile(appPath, 'utf8');
app = app.replace(
  `  lastRefreshAt = new Date().toISOString();\n  scheduleStateCacheWrite(activeRepo);\n  if (!hasUnsavedDraft()) renderPreservingScroll();`,
  `  lastRefreshAt = new Date().toISOString();\n  if (!hasUnsavedDraft()) renderPreservingScroll();\n  scheduleStateCacheWrite(activeRepo);`,
);
await writeFile(appPath, app);

// The patch runner advances old v24-positive assertions to v25. The new
// performance test intentionally contains a negative v24 assertion too,
// so restore that one rather than letting replaceAll invert its meaning.
const fluidTestPath = 'test/fluid-performance.test.mjs';
let fluidTest = await readFile(fluidTestPath, 'utf8');
fluidTest = fluidTest.replace(
  'assert.doesNotMatch(sw, /donezo-shell-v25/);',
  'assert.doesNotMatch(sw, /donezo-shell-v24/);',
);
await writeFile(fluidTestPath, fluidTest);

// The old reaction regression pinned local variable names from the
// network-first implementation. Keep the same semantic/database contract,
// but assert the new explicit persistence + optimistic UI boundaries.
const reactionTestPath = 'test/mobile-social-proof-polish.test.mjs';
let reactionTest = await readFile(reactionTestPath, 'utf8');
const oldReactionBlock = `test('positive reaction toggles replace the previous positive reaction only', () => {\n  assert.match(store, /positiveReactions/);\n  assert.match(store, /emoji !== '👎'/);\n  assert.match(store, /\\.delete\\(\\)[\\s\\S]*\\.neq\\('emoji', '👎'\\)/);\n  assert.match(migration, /row_number\\(\\)[\\s\\S]*partition by check_in_id, user_id/i);\n  assert.match(migration, /where emoji <> '👎'/i);\n  assert.match(migration, /create unique index[\\s\\S]*check_in_id, user_id/i);\n});`;
const newReactionBlock = `test('positive reaction toggles replace the previous positive reaction only', () => {\n  assert.match(store, /async function setPositiveReaction\\(checkInId, emoji\\)/);\n  assert.match(store, /\\.delete\\(\\)[\\s\\S]*\\.neq\\('emoji', '👎'\\)/);\n  assert.match(store, /if \\(emoji\\)/);\n  assert.match(app, /createLatestIntentCoordinator/);\n  assert.match(app, /repo\\.applyPositiveReaction\\(checkInId, desired\\)/);\n  assert.match(migration, /row_number\\(\\)[\\s\\S]*partition by check_in_id, user_id/i);\n  assert.match(migration, /where emoji <> '👎'/i);\n  assert.match(migration, /create unique index[\\s\\S]*check_in_id, user_id/i);\n});`;
if (!reactionTest.includes(oldReactionBlock)) throw new Error('Reaction regression block changed unexpectedly');
reactionTest = reactionTest.replace(oldReactionBlock, newReactionBlock);
await writeFile(reactionTestPath, reactionTest);

let patched = await readFile(storePath, 'utf8');
const patchedCompleteStart = patched.indexOf('  async function completeWithProof(habitId, date, file) {');
const patchedDownvoteStart = patched.indexOf('  async function setProofDownvote(checkInId, downvoted) {', patchedCompleteStart);
if (patchedCompleteStart < 0 || patchedDownvoteStart < 0) throw new Error('Could not restore completeWithProof');
patched = `${patched.slice(0, patchedCompleteStart)}${completeWithProof}${patched.slice(patchedDownvoteStart)}`;
await writeFile(storePath, patched);
