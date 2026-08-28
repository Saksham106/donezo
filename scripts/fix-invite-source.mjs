import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/app.js';
let source = await readFile(path, 'utf8');
if (source.includes('function render() {')) {
  console.log('render function already fixed');
  process.exit(0);
}
const broken = 'function render()\n  if (!session) {';
if (!source.includes(broken)) throw new Error('Expected broken render signature was not found');
source = source.replace(broken, 'function render() {\n  if (!session) {');
await writeFile(path, source);
