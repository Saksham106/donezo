import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const url = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required');
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  outfile: 'dist/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  define: {
    __SUPABASE_URL__: JSON.stringify(url),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
  },
});
await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('src/pwa.js', 'dist/pwa.js'),
  cp('tokens.css', 'dist/tokens.css'),
  cp('styles.css', 'dist/styles.css'),
  cp('components.css', 'dist/components.css'),
  cp('social.css', 'dist/social.css'),
  cp('manifest.webmanifest', 'dist/manifest.webmanifest'),
  cp('icon.svg', 'dist/icon.svg'),
  cp('sw.js', 'dist/sw.js'),
]);

const shellAssets = [
  'index.html',
  'pwa.js',
  'tokens.css',
  'styles.css',
  'components.css',
  'social.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
];
const shellContents = await Promise.all(shellAssets.map((asset) => readFile(`dist/${asset}`)));
const buildId = shellContents
  .reduce((hash, content) => hash.update(content), createHash('sha256'))
  .digest('hex')
  .slice(0, 12);
const serviceWorker = (await readFile('sw.js', 'utf8')).replace('__BUILD_ID__', buildId);
await writeFile('dist/sw.js', serviceWorker);
