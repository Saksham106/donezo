// The UI used to live in one src/app.js. Source-level checks now read the
// entry plus every screen module under src/ui/ as one string.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../src/', import.meta.url);
const files = ['app.js', ...readdirSync(new URL('ui/', root)).filter((name) => name.endsWith('.js')).sort().map((name) => `ui/${name}`)];

export const uiSource = files.map((file) => readFileSync(new URL(file, root), 'utf8')).join('\n');
