import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const migrationNames = await readdir(new URL('../supabase/migrations/', import.meta.url));
const migrationName = migrationNames.find((name) => name.includes('one_positive_reaction_per_proof'));
const migration = migrationName ? await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8') : '';
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

test('friend growth actions live in the Friends list sheet, not parent feed', () => {
  const friends = slice('function friendsScreen()', 'function challengeProgress');
  const people = slice('function peopleSheet()', 'function proofRejectSheet');
  assert.doesNotMatch(friends, /data-invite-open|data-add-friend-open/);
  assert.match(people, /data-invite-from-people/);
  assert.match(people, /data-add-friend-from-people/);
});

test('proof cards lead with habit identity and preview at most two replies', () => {
  const card = slice('function activityCard(', 'function personProofCarousel');
  assert.match(card, /proof-card-title/);
  assert.match(card, /proof-card-byline/);
  assert.match(card, /proofReplyPreview/);
  assert.match(app, /function proofReplyPreview\(/);
  assert.match(app, /\.slice\(-2\)/);
  assert.match(app, /View all .* replies/);
});

test('positive reaction toggles replace the previous positive reaction only', () => {
  assert.match(store, /async function setPositiveReaction\(checkInId, emoji\)/);
  assert.match(store, /\.delete\(\)[\s\S]*\.neq\('emoji', '👎'\)/);
  assert.match(store, /if \(emoji\)/);
  assert.match(app, /createLatestIntentCoordinator/);
  assert.match(app, /repo\.applyPositiveReaction\(checkInId, desired\)/);
  assert.match(migration, /row_number\(\)[\s\S]*partition by check_in_id, user_id/i);
  assert.match(migration, /where emoji <> '👎'/i);
  assert.match(migration, /create unique index[\s\S]*check_in_id, user_id/i);
});

test('touch app content is non-selectable while text entry remains selectable', () => {
  assert.match(styles, /@media\s*\(pointer:\s*coarse\)/);
  assert.match(styles, /user-select:\s*none/);
  assert.match(styles, /input[^}]*user-select:\s*text|textarea[^}]*user-select:\s*text|contenteditable[^}]*user-select:\s*text/s);
});

test('standard bottom sheets initialize reusable swipe-down dismissal', () => {
  assert.match(app, /function bindSheetSwipeDismiss\(/);
  assert.match(app, /querySelectorAll\('\[data-sheet\]'\)/);
  assert.match(app, /closeSheets\(\)/);
  assert.match(social, /\.sheet\.is-dragging|\.sheet-backdrop\.is-dragging/);
});

test('PWA shell cache uses the build fingerprint placeholder', () => {
  assert.doesNotMatch(sw, /donezo-shell-v23/);
  assert.match(sw, /donezo-shell-__BUILD_ID__/);
});
