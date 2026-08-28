import { readFile } from 'node:fs/promises';

const app = await readFile('src/app.js', 'utf8');
if (app.includes("from './invite.js'")) {
  console.log('Invite flow already applied.');
  process.exit(0);
}
await import('./apply-invite-flow.mjs');
