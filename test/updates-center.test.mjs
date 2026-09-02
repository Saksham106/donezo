import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

function slice(start, end) {
  return app.slice(app.indexOf(`function ${start}`), app.indexOf(`function ${end}`));
}

test('Friends is a proof-only feed with no Proofs Activity tab state', () => {
  const friends = slice('friendsScreen', 'leagueScreen');
  assert.match(friends, /filter\(\(activity\) => activity\.proofPath\)/);
  assert.doesNotMatch(app, /donezo\.squadFeed/);
  assert.doesNotMatch(app, /data-squad-feed/);
  assert.doesNotMatch(app, /let squadFeed/);
});

test('Updates mixes incoming nudges and every non-proof activity newest first', () => {
  assert.match(app, /function updatesList/);
  assert.match(app, /incomingNudges\(\)/);
  assert.match(app, /filter\(\(activity\) => !activity\.proofPath\)/);
  assert.match(app, /sort\(\(a, b\) => new Date\(b\.when\).*new Date\(a\.when\)/s);
  const inbox = slice('nudgeInboxSheet', 'settingsSheet');
  assert.match(inbox, /UPDATES/);
  assert.match(inbox, /kind === 'nudge'/);
  assert.match(inbox, /kind === 'activity'/);
});

test('Updates badge counts unseen activity plus unread nudges and opening persists seen state', () => {
  assert.match(app, /function unseenUpdatesCount/);
  assert.match(app, /updatesLastSeenAt/);
  assert.match(app, /!nudge\.readAt/);
  assert.match(app, /applyUpdatesSeen/);
  assert.match(app, /markUpdatesSeen/);
  assert.match(app, /unseenUpdatesCount\(\)/);
});
