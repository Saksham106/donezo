import { readFile, writeFile } from 'node:fs/promises';

const storePath = 'src/store.js';
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

let patched = await readFile(storePath, 'utf8');
const patchedCompleteStart = patched.indexOf('  async function completeWithProof(habitId, date, file) {');
const patchedDownvoteStart = patched.indexOf('  async function setProofDownvote(checkInId, downvoted) {', patchedCompleteStart);
if (patchedCompleteStart < 0 || patchedDownvoteStart < 0) throw new Error('Could not restore completeWithProof');
patched = `${patched.slice(0, patchedCompleteStart)}${completeWithProof}${patched.slice(patchedDownvoteStart)}`;
await writeFile(storePath, patched);
