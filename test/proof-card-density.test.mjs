import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start: ${start}`);
  assert.ok(to > from, `missing end: ${end}`);
  return source.slice(from, to);
}

test('proof cards show display name plus relative and exact time without username or streak', () => {
  const card = section(app, 'function activityCard(', 'function personProofCarousel');
  const proofStart = card.indexOf('if (activity.proofPath)');
  const fallbackStart = card.indexOf('\n  return `<article class="activity ${activity.invalid', proofStart);
  assert.ok(proofStart >= 0 && fallbackStart > proofStart, 'proof branch must be independently inspectable');
  const proofBranch = card.slice(proofStart, fallbackStart);
  assert.match(proofBranch, /proof-card-title/);
  assert.match(proofBranch, /actor\?\.name|actorName/);
  assert.match(proofBranch, /formatWhen\(activity\.when\)/);
  assert.match(proofBranch, /formatExactTime\(activity\.when\)/);
  assert.doesNotMatch(proofBranch, /actor\?\.handle|actorHandle/);
  assert.doesNotMatch(proofBranch, /activity\.streak/);
  assert.doesNotMatch(proofBranch, /mine \? 'You'/);
});

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
