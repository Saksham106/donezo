import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tokens = await readFile(new URL('../tokens.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

function darkBlock() {
  const start = tokens.indexOf('[data-theme="dark"]');
  const end = tokens.indexOf('@media (prefers-color-scheme: dark)', start);
  return tokens.slice(start, end);
}

function systemDarkBlock() {
  return tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
}

test('dark mode uses warm graphite neutrals instead of navy-tinted app surfaces', () => {
  const explicit = darkBlock();
  for (const token of ['paper', 'paper-2', 'paper-3', 'surface', 'canvas', 'rule', 'rule-strong']) {
    assert.match(explicit, new RegExp(`--color-${token}:\\s*oklch\\([^;]*(?:55|65|75)\\)`));
    assert.doesNotMatch(explicit, new RegExp(`--color-${token}:\\s*oklch\\([^;]*258\\)`));
  }
});

test('dark surface hierarchy gets lighter with elevation while text stays soft warm white', () => {
  const explicit = darkBlock();
  assert.match(explicit, /--color-canvas:\s*oklch\(14\.5% 0\.01 65\)/);
  assert.match(explicit, /--color-paper:\s*oklch\(18\.5% 0\.012 65\)/);
  assert.match(explicit, /--color-surface:\s*oklch\(23% 0\.013 65\)/);
  assert.match(explicit, /--color-paper-3:\s*oklch\(27% 0\.014 65\)/);
  assert.match(explicit, /--color-ink:\s*oklch\(95% 0\.012 82\)/);
  assert.match(explicit, /--color-muted:\s*oklch\(74% 0\.014 82\)/);
});

test('dark accent remains Donezo coral but is less saturated than the old dark palette', () => {
  const explicit = darkBlock();
  assert.match(explicit, /--color-coral:\s*oklch\(64% 0\.155 32\)/);
  assert.match(explicit, /--color-coral-soft:\s*oklch\(29% 0\.05 32\)/);
  assert.match(explicit, /--color-on-accent:\s*oklch\(18\.5% 0\.012 65\)/);
});

test('system dark mode mirrors the warm graphite neutral palette', () => {
  const system = systemDarkBlock();
  assert.match(system, /--color-paper:\s*oklch\(18\.5% 0\.012 65\)/);
  assert.match(system, /--color-surface:\s*oklch\(23% 0\.013 65\)/);
  assert.match(system, /--color-canvas:\s*oklch\(14\.5% 0\.01 65\)/);
  assert.doesNotMatch(system, /--color-paper:\s*oklch\([^;]*258\)/);
});

test('browser theme color follows warm graphite rather than the old blue shell', () => {
  assert.match(app, /dark \? '#1e1b18' : '#f7f2e8'/);
  assert.doesNotMatch(app, /dark \? '#1d2433'/);
});
