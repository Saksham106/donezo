import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function slice(start, end) {
  return app.slice(app.indexOf(`function ${start}`), app.indexOf(`function ${end}`));
}

test('proof reply previews stay compact despite the global button touch target', () => {
  assert.match(social, /\.proof-reply-preview\{[^}]*gap:\.18rem/);
  assert.match(social, /\.proof-reply-author,\.proof-reply-all\{[^}]*min-height:0!important/);
});

test('zero-reaction proof cards do not render hype helper copy', () => {
  assert.doesNotMatch(app, /Be the first to hype this/);
  assert.match(social, /\.reaction-summary:empty\{display:none\}/);
});
