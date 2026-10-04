import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');

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
