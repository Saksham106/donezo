import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('mobile social stylesheet is complete and not accidentally swallowed by a malformed rule', () => {
  assert.doesNotMatch(social, /\[truncated\]/);
  assert.match(social, /\.activation-card\{[^}]*padding:/s);
  assert.match(social, /\.baton-card\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/s);
  assert.doesNotMatch(social, /\.baton-copy strong\{[^}]*text-overflow:ellipsis/s);
  assert.match(social, /\.pwa-update-banner\{[^}]*position:fixed/s);
});

test('mobile controls have robust touch targets and a thicker bottom bar anchored to the bottom', () => {
  assert.match(styles, /\.nav\{[^}]*padding:\.3rem[^}]*var\(--app-safe-bottom\)/s);
  assert.match(styles, /\.nav-btn\{[^}]*min-height:\s*3\.35rem/s);
  assert.match(styles, /\.nav-icon\{[^}]*width:\s*1\.3rem/s);
  assert.match(styles, /\.app-shell\{[^}]*inset:\s*0/s);
  assert.match(social, /\.people-sheet/);
  assert.match(social, /\.squad-feed-tabs/);
  assert.match(social, /\.people-row/);
});
