import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
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

test('profiles separate proof history from non-proof activity without duplication', () => {
  const profile = slice('friendProfileSheet', 'recoverySheet');
  assert.match(profile, /const otherActivity = recent\.filter\(\(item\) => !item\.proofPath\)/);
  assert.match(profile, /<strong>Other activity<\/strong>/);
  assert.doesNotMatch(profile, /<strong>All activity<\/strong>/);
  assert.match(profile, /otherActivity\.map\(\(item\) => activityCard/);
});

test('hidden proof replies use a small blue More link', () => {
  const preview = slice('proofReplyPreview', 'activityCard');
  assert.match(preview, />More<\/button>/);
  assert.doesNotMatch(preview, /View all .* replies/);
  assert.match(social, /\.proof-reply-all\{[^}]*color:var\(--color-cobalt\)/);
  assert.match(social, /\.proof-reply-all\{[^}]*font-size:var\(--text-2xs\)/);
});
