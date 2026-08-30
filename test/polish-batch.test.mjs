import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contextualHabitStatus, groupSquadActivity } from '../src/ux.js';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const components = await readFile(new URL('../components.css', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');

const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

test('League challenge has clear action and explanation while Friendly Stake creation is removed', () => {
  const league = slice('function leagueScreen()', 'function stakeHistory()');
  assert.match(league, /data-challenge-info/);
  assert.match(league, /aria-label="How do challenges work\?"/);
  assert.match(league, /aria-label="Start a weekly challenge"/);
  assert.doesNotMatch(league, /Start a friendly stake|data-stake-create|data-open-stake/);
  assert.match(app, /function challengeInfoSheet\(\)/);
});

test('weekday selection automatically changes schedule to specific days', () => {
  assert.match(app, /scheduleWeekdays/);
  assert.match(app, /scheduleFrequency\.value = 'selected_weekdays'/);
});

test('proof reactions expose selected state, tallies, and explicit feedback without colliding with the habit emoji picker', () => {
  assert.match(app, /aria-pressed="\$\{active\}"/);
  assert.match(app, /visibleReactionCounts/);
  assert.match(app, /Math\.max\(1, Number\(visibleReactionCounts\[emoji\]/);
  assert.match(app, /reaction-summary/);
  assert.match(app, /You reacted/);
  assert.match(app, /data-reaction-emoji="\$\{emoji\}"/);
  assert.match(app, /element\.dataset\.reactionEmoji/);
  assert.doesNotMatch(app, /data-reaction="\$\{activity\.checkInId\}" data-emoji=/);
  assert.match(social, /\.reaction-btn\.active/);
  assert.match(social, /\.reaction-summary/);
});

test('League identifies the current user by name only', () => {
  assert.match(app, /league-name[^`]*mine/);
  assert.doesNotMatch(components, /\.league-row\.mine\{[^}]*background:/s);
  assert.match(social, /\.league-name\.mine/);
});

test('mutations expose status, haptics, safe retry and date-stable reversible Undo actions', () => {
  assert.match(app, /function haptic\(/);
  assert.match(app, /mutationStatus/);
  assert.match(app, /data-retry-mutation/);
  assert.match(app, /action:\s*\{\s*label:\s*'Undo'/);
  assert.match(app, /handleUndoCheckIn/);
  assert.match(app, /handleUndoCommentDelete/);
  assert.match(app, /handleUndoArchive/);
  assert.match(store, /restoreHabit/);
  assert.match(app, /mutationStatus === 'failed' && retryMutation && online/);
  const mutation = slice('async function runMutation', 'async function handleAuth');
  const ambiguousFailure = mutation.slice(mutation.indexOf('} catch (error)'));
  assert.doesNotMatch(ambiguousFailure, /retryMutation\s*=\s*\(\)/);
  assert.match(ambiguousFailure, /retryMutation\s*=\s*null/);
  assert.match(app, /const checkInDate = today\(\)/);
  assert.match(app, /completeWithProof\(review\.habitId, checkInDate, review\.file\)/);
  assert.match(app, /handleUndoCheckIn\(review\.habitId, checkInDate\)/);
  assert.match(app, /handleUndoCheckIn\(id, checkInDate\)/);
});

test('schedule edit guard includes timezone changes after today check-in', () => {
  const submit = slice('async function handleHabitSubmit', 'async function handlePauseSubmit');
  assert.match(submit, /input\.scheduleTimezone\s*!==\s*\(existing\.scheduleTimezone/);
});

test('navigation state and scroll positions survive rerenders', () => {
  assert.match(app, /donezo\.activeTab/);
  assert.match(app, /PRIMARY_TABS\.includes\(requestedTab\) \? requestedTab : 'today'/);
  assert.match(app, /function setActiveTab\(nextTab\)/);
  assert.match(app, /if \(!habitId\) setActiveTab\('today'\)/);
  assert.match(app, /else if \(step === 3\) openCheckInAction\(\)/);
  assert.match(app, /else if \(step === 4\) setActiveTab\('squad'\)/);
  assert.match(app, /createdCircleInvite = null; setActiveTab\('today'\)/);
  assert.match(app, /donezo\.squadFeed/);
  assert.match(app, /screenScroll/);
  assert.match(app, /restoreScreenScroll/);
});

test('activity grouping and visual signatures avoid grouping proofs or comments', () => {
  const grouped = groupSquadActivity([
    { checkInId: 'a', type: 'completed', userId: 'u1', habitTitle: 'Run', when: '2026-08-30T10:00:00Z' },
    { checkInId: 'b', type: 'completed', userId: 'u2', habitTitle: 'Run', when: '2026-08-30T09:57:00Z' },
    { checkInId: 'c', type: 'completed', userId: 'u3', habitTitle: 'Read', proofPath: 'proof.jpg', when: '2026-08-30T09:55:00Z' },
  ], []);
  assert.equal(grouped[0].type, 'grouped_checkin');
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[1].checkInId, 'c');
  assert.match(app, /activity-signature/);
  assert.doesNotMatch(app, /<article class="activity grouped activity-signature/);
  assert.match(social, /\.activity-signature/);
});

test('contextual habit language handles completed and upcoming commitments', () => {
  assert.match(contextualHabitStatus({ completedAt: '2026-08-30T10:00:00Z' }, { now: '2026-08-30T10:03:00Z' }), /Done 3m ago/);
  assert.equal(contextualHabitStatus({ completedAt: 'not-a-date' }), 'Done');
  assert.match(contextualHabitStatus({ targetTime: '12:00' }, { now: '2026-08-30T10:00:00', date: '2026-08-30' }), /Due in 2h/);
  assert.equal(
    contextualHabitStatus(
      { targetTime: '12:00', scheduleTimezone: 'UTC' },
      { now: '2026-08-30T12:00:00Z', date: '2026-08-30' },
    ),
    'Due now',
  );
  assert.equal(
    contextualHabitStatus(
      { targetTime: '12:00', scheduleTimezone: 'America/New_York' },
      { now: '2026-08-30T16:00:00Z', date: '2026-08-30' },
    ),
    'Due now',
  );
  assert.match(contextualHabitStatus({ targetTime: '9:00' }, { now: '2026-08-30T08:00:00', date: '2026-08-30' }), /Due in 60m/);
});

test('empty states are actionable and loading uses stable skeletons', () => {
  assert.match(app, /empty-action/);
  assert.match(app, /loading-skeleton/);
  assert.match(social, /\.loading-skeleton/);
});

test('Settings is a phone-native menu with separate detail views and hidden scrollbars', () => {
  assert.match(app, /settingsView/);
  assert.match(app, /data-settings-view="profile"/);
  assert.match(app, /data-settings-view="squads"/);
  assert.match(app, /data-settings-view="notifications"/);
  assert.match(app, /data-settings-view="social"/);
  assert.match(app, /data-settings-back/);
  assert.match(social, /\.settings-menu/);
  assert.match(social, /\.settings-sheet[^}]*scrollbar-width:none/s);
  assert.match(social, /\.settings-sheet::-webkit-scrollbar/);
});

test('sheet close handlers do not reference removed archive-confirm state', () => {
  assert.doesNotMatch(app, /archiveConfirm/);
  assert.match(app, /function closeSheets\(\)[\s\S]*settingsSheetOpen = false/);
});

test('baton preference uses one enabled-state contract in the app and both repositories', () => {
  assert.match(app, /repo\.setBatonEnabled\(batonEnabled\)/);
  assert.doesNotMatch(app, /setBatonOptOut/);
  assert.equal((store.match(/function setBatonEnabled\(enabled\)/g) || []).length, 2);
  assert.match(store, /set_baton_opt_out', \{ enabled: Boolean\(enabled\) \}/);
  assert.match(store, /state\.batonOptedOut = !Boolean\(enabled\)/);
});
