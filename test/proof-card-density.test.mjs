import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiSource } from './helpers/ui-source.mjs';

const app = uiSource;
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('habit title and byline are visually one compact header block', () => {
  assert.match(social, /\.proof-card-header\{[^}]*margin-bottom:var\(--space-1\)/);
  assert.match(social, /\.proof-card-byline\{[^}]*margin-top:\.(?:15|18|2|22|25)rem/);
});

test('Reply gets a larger horizontal hit area without a taller social row', () => {
  const rule = social.match(/\.comment-open\{[^}]*\}/)?.[0] || '';
  assert.match(rule, /min-height:var\(--size-target-min\)/);
  assert.match(rule, /min-width:/);
  assert.match(rule, /padding:0 [^;]+/);
  assert.match(rule, /font-size:var\(--text-sm\)/);
  assert.doesNotMatch(rule, /min-height:(?:3|4|5)rem/);
});
