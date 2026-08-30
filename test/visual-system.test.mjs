import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [tokens, styles, components, social, html] = await Promise.all([
  readFile(new URL('../tokens.css', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../components.css', import.meta.url), 'utf8'),
  readFile(new URL('../social.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);
const css = `${tokens}\n${styles}\n${components}\n${social}`;

const statuses = ['due', 'due-soon', 'completed', 'missed', 'challenged', 'recovered'];

test('visual system exposes complete semantic habit status tokens', () => {
  for (const status of statuses) {
    assert.match(tokens, new RegExp(`--color-status-${status}:`));
    assert.match(tokens, new RegExp(`--color-status-${status}-surface:`));
    assert.match(tokens, new RegExp(`--color-status-${status}-ink:`));
    assert.match(tokens, new RegExp(`--color-status-${status}-border:`));
  }
  for (const status of statuses) {
    assert.ok(css.includes(`.status-${status}`));
  }
  assert.match(css, /\[data-status="due"\]/);
  assert.match(css, /\[data-status="due-soon"\]/);
});

test('interactive controls use a shared 44px minimum target', () => {
  assert.match(tokens, /--size-target-min:\s*44px/);
  for (const selector of ['\.btn', '\.icon-btn', '\.top-icon-btn', '\.nav-btn', '\.invite-icon-btn', '\.vote-btn']) {
    assert.match(css, new RegExp(`${selector}[^}]*min-(?:height|width):var\\(--size-target-min\\)`));
  }
  assert.match(css, /\.form input,\.form select[^}]*min-height:var\(--size-target-min\)/);
});

test('avatars use stable identity color tokens with readable foregrounds', () => {
  for (let index = 1; index <= 6; index += 1) {
    assert.match(tokens, new RegExp(`--avatar-color-${index}:`));
    assert.match(tokens, new RegExp(`--avatar-color-${index}-ink:`));
  }
  assert.match(css, /\.avatar\[data-avatar-color\]/);
  assert.match(css, /--avatar-identity-bg/);
  assert.match(css, /--avatar-identity-ink/);
});

test('proof, empty, loading, and error states have explicit accessible treatments', () => {
  for (const selector of ['\.state-proof', '\.state-empty', '\.state-loading', '\.state-error', '\.proof-error', '\.empty', '\.loading']) {
    assert.match(css, new RegExp(selector));
  }
  assert.match(css, /\.state-loading[^}]*aria-busy/);
  assert.match(css, /\.state-error[^}]*color:var\(--color-state-error-ink\)/);
  assert.match(css, /\.state-empty[^}]*color:var\(--color-state-empty-ink\)/);
});

test('celebration motion is restrained and disabled for reduced-motion users', () => {
  assert.match(css, /@keyframes\s+donezo-celebrate/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*no-preference\)[\s\S]*\.celebrate/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.celebrate[^}]*animation:\s*none/);
  assert.match(css, /\.celebrate[^}]*animation:\s*donezo-celebrate/);
});

test('keyboard focus remains visible across native and custom controls', () => {
  assert.match(styles, /button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible/);
  assert.match(styles, /\.text-btn:focus-visible/);
  assert.match(styles, /outline-offset:3px/);
  assert.match(css, /\[role="button"\]:focus-visible/);
});

test('mobile viewport and app surfaces account for safe areas', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /color-scheme" content="light dark"/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /--safe-area-top/);
  assert.match(css, /--safe-area-bottom/);
});

test('dark mode remaps semantic tokens without changing component selectors', () => {
  assert.match(tokens, /\[data-theme="dark"\]/);
  assert.match(tokens, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  for (const token of ['--color-paper', '--color-surface', '--color-ink', '--color-muted', '--color-rule', '--color-coral', '--color-status-completed-surface']) {
    const darkSection = tokens.slice(tokens.indexOf('[data-theme="dark"]'));
    assert.match(darkSection, new RegExp(`${token}:`));
  }
  assert.match(styles, /color-scheme:light dark/);
});
