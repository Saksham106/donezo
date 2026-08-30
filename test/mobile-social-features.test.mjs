import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

test('Squad exposes one compact baton card with an explicit pass action', () => {
  assert.match(app, /function batonCard\(/);
  assert.match(app, /data-pass-baton/);
  assert.match(app, /The baton is with/);
  assert.match(social, /\.baton-card/);
});

test('activity supports lightweight comments without becoming a chat product', () => {
  assert.match(app, /data-comment-open/);
  assert.match(app, /function commentSheet\(/);
  assert.match(app, /id="comment-form"/);
  assert.match(app, /maxlength="180"/);
  assert.match(social, /\.comment-sheet/);
});

test('Me shows permanent milestone badges separately from monthly awards', () => {
  assert.match(app, /function badgeCabinet\(/);
  assert.match(app, /Milestones/);
  assert.match(app, /data-badge-cabinet/);
  assert.match(social, /\.badge-cabinet/);
});

test('monthly Wrapped is a short dismissible story with restrained celebration', () => {
  assert.match(app, /function monthlyWrappedSheet\(/);
  assert.match(app, /data-wrapped-next/);
  assert.match(app, /data-wrapped-close/);
  assert.match(app, /wrapped.*confetti/is);
  assert.match(social, /\.wrapped-sheet/);
  assert.match(social, /prefers-reduced-motion[\s\S]*\.wrapped-confetti/s);
});
