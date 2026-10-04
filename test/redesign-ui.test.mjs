// Guards for the redesigned shell (src/ui/*). Business rules live in
// today-domain.test.mjs; these checks pin the wiring that is hard to
// exercise without a browser: native inputs, swipe guards, read-only boot,
// share activation, and the design tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const entry = read('src/app.js');
const state = read('src/ui/state.js');
const render = read('src/ui/render.js');
const checkin = read('src/ui/checkin.js');
const home = read('src/ui/home.js');
const people = read('src/ui/people.js');
const sync = read('src/ui/sync.js');
const settings = read('src/ui/settings.js');
const store = read('src/store.js');
const css = read('redesign.css');
const build = read('scripts/build.mjs');

const section = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to >= 0 ? to : undefined);
};

test('bottom nav is Home, Friends, raised Check In, Standings, Profile', () => {
  const nav = section(render, 'function nav()', 'function sheets()');
  const order = ["item('home'", "item('friends'", 'data-checkin-action', "item('standings'", "item('profile'"].map((needle) => nav.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), 'every nav item renders');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'nav order matches the design');
  assert.match(state, /PRIMARY_TABS = \['home', 'friends', 'standings', 'profile'\]/);
});

test('old tab names from push links and localStorage map onto the new tabs', () => {
  assert.match(state, /today: 'home', checkin: 'home', squad: 'friends', league: 'standings', me: 'profile'/);
  // The deep-link parser defaults to 'today'; only an explicit ?tab= should override the remembered tab.
  assert.match(state, /searchParams\.has\('tab'\)/);
});

test('Check In is an overlay: 0 due → caught up, 1 due → straight to proof, 2+ → picker', () => {
  const open = section(checkin, 'export function openCheckIn()', 'export function closeCheckInOverlay()');
  assert.match(open, /!due\.length && !misses\.length[\s\S]*'caught-up'/);
  assert.match(open, /due\.length === 1 && !misses\.length[\s\S]*handleHabit\(due\[0\]\.id\)/);
  assert.match(open, /checkInOverlay = 'picker'/);
  assert.doesNotMatch(open, /setActiveTab/, 'opening Check In never changes tab');
  const picker = section(checkin, 'function pickerSheet()', 'export function checkInUndoSheet()');
  assert.match(picker, /proofMode === 'photo'/);
  assert.match(picker, /icon\('camera'/);
  assert.match(picker, /dz-pick-mark \$\{photo \? 'photo' : 'tick'\}/);
});

test('tab switches remember scroll per tab; sheets close without moving the tab', () => {
  assert.match(render, /screenScroll\[ui\.tab\] = scroller\.scrollTop/);
  assert.match(render, /restoreScreenScroll\(\)/);
  const close = section(render, 'export function closeSheets()', 'function dismissSheet(');
  assert.doesNotMatch(close, /setActiveTab|ui\.tab\s*=/);
  assert.match(close, /closeCheckInOverlay\(\)/);
  assert.match(close, /resetProofFlow\(\)/);
});

test('native proof inputs are bound before the first await and clicked synchronously', () => {
  assert.ok(entry.indexOf('bindNativeProofInputs();') >= 0);
  assert.ok(entry.indexOf('bindNativeProofInputs();') < entry.indexOf('await supabase.auth.getSession()'));
  assert.match(checkin, /\(role === 'main' \? inputs\.selfie : inputs\.dualMain\)\?\.click\(\)/);
  assert.doesNotMatch(checkin, /getUserMedia/);
  assert.match(checkin, /const habitId = ui\.proofHabit \|\| ui\.proofReview\?\.habitId/);
  assert.match(checkin, /currentHabitId !== habitId/);
  assert.match(checkin, /Submit proof/);
  assert.match(checkin, /Make Dual/);
});

test('an uploading proof review cannot be swiped away, and only the top sheet swipes', () => {
  assert.match(checkin, /data-no-swipe="\$\{uploading\}"/);
  const swipe = section(render, 'export function bindSheetSwipeDismiss()', 'function bindPullToRefresh(');
  assert.match(swipe, /dataset\.noSwipe !== 'true'/);
  assert.match(swipe, /\.at\(-1\) === sheet/);
});

test('cached boot is read-only until an authoritative load, and stale boots are ignored', () => {
  assert.match(sync, /if \(!ui\.networkBootLoading && ui\.authoritativeReady\) return false;/);
  assert.match(section(sync, 'export async function runOptimisticMutation(', 'export async function runMutation('), /dataNotReady\(\)/);
  assert.match(section(sync, 'export async function runMutation(', 'export function hasUnsavedDraft('), /!ui\.authoritativeReady/);
  const boot = section(entry, 'async function boot(', 'for (const eventName');
  assert.match(boot, /generation !== ui\.bootGeneration/);
  assert.match(boot, /ui\.authoritativeReady = false/);
  assert.match(boot, /ui\.authoritativeReady = true/);
  const cachedFailure = boot.slice(boot.indexOf('if (cachedRendered)'));
  assert.doesNotMatch(cachedFailure.slice(0, cachedFailure.indexOf('stopRefreshCoordinator')), /authoritativeReady = true/);
});

test('reactions, replies and rejections use the optimistic lane, not runMutation', () => {
  assert.match(home, /createLatestIntentCoordinator/);
  for (const name of ['handleReaction', 'handleCommentSubmit', 'handleDownvote']) {
    const start = home.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing ${name}`);
    const body = home.slice(start, home.indexOf('\n}\n', start));
    assert.doesNotMatch(body, /runMutation\s*\(/, `${name} should not block on the global mutation lane`);
  }
});

test('background refresh never steals focus or rebuilds a scrolled feed', () => {
  const drafts = section(sync, 'export function hasUnsavedDraft()', 'function shouldDeferFeedRender()');
  assert.match(drafts, /ui\.friendsQuery/);
  assert.match(drafts, /document\.activeElement\?\.matches\?\.\('input, textarea, select'\)/);
  assert.match(sync, /ui\.tab === 'home' && scrollTop > 4/);
  assert.match(section(sync, 'async function refreshRepositoryData(', 'export function stopRefreshCoordinator('), /!hasUnsavedDraft\(\) && !shouldDeferFeedRender\(\)/);
});

test('invite share keeps native share activation by priming the invite first', () => {
  assert.match(section(people, 'export function openPeopleSheet()', 'export function friendRemovalSheet()'), /primeFriendInvite\(\)/);
  const prepared = section(people, 'async function sharePreparedInvite(', 'export async function handleShareInvite()');
  const firstAwait = prepared.indexOf('await ');
  assert.equal(prepared.indexOf('navigator.share('), firstAwait + 'await '.length, 'navigator.share must be the first awaited call');
});

test('theme choice supports system, light and dark', () => {
  for (const choice of ['system', 'light', 'dark']) assert.match(settings, new RegExp(`themeButton\\('${choice}'`));
  assert.match(settings, /dark \? '#1e1b18' : '#f7f2e8'/);
});

test('Updates reads recipient notification events with metadata', () => {
  assert.match(store, /from\('notification_events'\)\.select\([^\n]*metadata/);
  assert.match(store, /eq\('recipient_user_id', user\.id\)/);
});

test('push deep links open the post, the habit, or Updates', () => {
  const nav = section(entry, 'async function applyInitialNavigation()', 'async function boot(');
  assert.match(nav, /initialNavigation\.nudgesOpen[\s\S]*openUpdatesCenter\(\)/);
  assert.match(nav, /initialNavigation\.tab === 'checkin'[\s\S]*handleHabit\(initialNavigation\.habitId\)/);
  assert.match(nav, /openCommentSheet\(initialNavigation\.checkInId\)/);
  assert.doesNotMatch(entry, /handleProofView/);
});

test('redesign stylesheet ships with the build and follows the v3 design', () => {
  assert.match(build, /cp\('redesign\.css', 'dist\/redesign\.css'\)/);
  assert.match(build, /'redesign\.css',/);
  assert.match(entry, /link\.href = '\/redesign\.css'/);
  assert.match(css, /--dz-font: 'gg sans', 'Noto Sans', system-ui/);
  assert.match(css, /--dz-nav-h: 86px/);
  assert.match(css, /--dz-tap: 44px/);
  assert.match(css, /width: 60px;\s*height: 60px;\s*margin-top: -28px/);
  assert.match(css, /aspect-ratio: 4 \/ 5;\s*border-radius: 14px/);
  assert.match(css, /\.rank-1 \.dz-podium-block \{ height: 92px; background: var\(--dz-coral\)/);
  assert.match(css, /:root\[data-theme='dark'\]/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\)/);
});

test('icon-only and pill controls keep at least a 44px hit area', () => {
  assert.match(css, /\.dz-icon-btn \{[^}]*width: var\(--dz-tap\);[^}]*height: var\(--dz-tap\)/s);
  assert.match(css, /\.dz-reaction::after, \.dz-chip-btn::after \{ content: ''; position: absolute; inset: -8px -2px; \}/);
  assert.match(css, /\.dz-btn\.small::after/);
});
