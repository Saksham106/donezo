import { readFile, writeFile } from 'node:fs/promises';

const patchPath = 'scripts/apply-fluid-review-fixes.mjs';
let patch = await readFile(patchPath, 'utf8');
const start = patch.indexOf('// Make the Friends action self-explanatory while the prefetch is still in flight.');
const endMarker = '\nawait writeFile(path, source);';
const end = patch.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Could not normalize Friends invite button patch');
const corrected = `// Make the Friends action self-explanatory while the prefetch is still in flight.\nsource = source.replace(\n  '<button class="btn primary full people-invite" type="button" data-invite-from-people>\${icon(\\'userPlus\\')} Invite friends</button>',\n  '<button class="btn primary full people-invite" type="button" data-invite-from-people \${friendInvitePreparing ? \\'disabled aria-busy="true"\\' : \\'\\'}>\${icon(\\'userPlus\\')} \${friendInvitePreparing ? \\'Preparing…\\' : \\'Invite friends\\'}</button>',\n);\n`;
patch = `${patch.slice(0, start)}${corrected}${patch.slice(end)}`;
await writeFile(patchPath, patch);
await import('./apply-fluid-review-fixes.mjs');
