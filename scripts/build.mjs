import { cp, mkdir, rm } from 'node:fs/promises';
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
  cp('styles.css', 'dist/styles.css'),
  cp('manifest.webmanifest', 'dist/manifest.webmanifest'),
  cp('icon.svg', 'dist/icon.svg'),
  cp('sw.js', 'dist/sw.js'),
]);
