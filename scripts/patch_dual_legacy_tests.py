from pathlib import Path


def replace_named_test(path_name, name, replacement):
    path = Path(path_name)
    text = path.read_text()
    marker = f"test('{name}',"
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f'missing test {name!r} in {path_name}')
    end = text.find('\ntest(', start + len(marker))
    if end < 0:
        end = len(text)
    text = text[:start] + replacement.rstrip() + '\n' + text[end:]
    path.write_text(text)


replace_named_test(
    'test/app-shell.test.mjs',
    'proof viewing stays inside the app and preserves context',
    r'''test('proof images stay inline and preserve context', () => {
  assert.doesNotMatch(app, /window\.open\(/);
  assert.match(app, /data-proof-image/);
  assert.match(app, /async function loadProofThumbnail/);
  assert.match(app, /getProofUrl/);
  assert.doesNotMatch(app, /function proofViewerSheet/);
  assert.doesNotMatch(app, />Open proof<\/button>/);
  assert.match(app, /activity\.habitTitle/);
  assert.match(app, /formatWhen\(activity\.when\)/);
});''',
)
replace_named_test(
    'test/app-shell.test.mjs',
    'proof viewer ignores stale signed-link and image failures',
    r'''test('inline proof loader handles expired image URLs without a viewer', () => {
  const loader = app.slice(app.indexOf('async function loadProofThumbnail'), app.indexOf('function bindProofThumbnails'));
  assert.match(loader, /proofThumbnailUrls\.get\(path\)/);
  assert.match(loader, /repo\.getProofUrl/);
  assert.match(loader, /proofThumbnailUrls\.delete\(path\)/);
  assert.match(loader, /element\.isConnected/);
  assert.doesNotMatch(app, /proofViewerRequestId/);
});''',
)

replace_named_test(
    'test/fluid-performance.test.mjs',
    'proof viewer reuses a cached signed thumbnail URL before signing again',
    r'''test('inline proof image loader reuses a cached signed URL before signing again', () => {
  const loader = section(app, 'async function loadProofThumbnail(', 'function bindProofThumbnails(');
  assert.match(loader, /proofThumbnailUrls\.get\(/);
  assert.match(loader, /repo\.getProofUrl/);
  assert.ok(loader.indexOf('proofThumbnailUrls.get(') < loader.indexOf('repo.getProofUrl'));
  assert.match(loader, /proofThumbnailUrls\.set\(/);
});''',
)

replace_named_test(
    'test/friends-ui.test.mjs',
    'Friends renders authorized Proofs and Activity feeds with compact heading actions',
    r'''test('Friends renders one authorized proof feed with compact heading actions', () => {
  const source = slice('friendsScreen', 'challengeProgress');
  assert.match(source, /pageHeading\('Friends'/);
  assert.match(source, /data-people-open/);
  assert.match(source, /data-manual-refresh/);
  assert.match(source, /activityList\(state\)\.filter\(\(activity\) => activity\.proofPath\)/);
  assert.match(source, /activityCard\(activity, \{ showProofActions: true \}\)/);
  assert.doesNotMatch(source, /squad-feed-tabs/);
  assert.doesNotMatch(source, /data-squad-feed/);
  assert.doesNotMatch(source, /groupSquadActivity/);
  assert.doesNotMatch(source, /One feed for the people you choose to show up with/);
  assert.doesNotMatch(source, /Hype your people|See what happened/);
  assert.match(social, /\.squad-refresh-row/);
});''',
)

replace_named_test(
    'test/league-friends-ux.test.mjs',
    'proof, activity, grouped check-ins, comments, and proof viewer identities open profiles',
    r'''test('proofs, Updates activity, and comments keep profile drill-downs', () => {
  const activity = app.slice(app.indexOf('function activityCard('), app.indexOf('function personProofCarousel('));
  const updates = app.slice(app.indexOf('function nudgeInboxSheet()'), app.indexOf('function inviteSheet()'));
  const comments = app.slice(app.indexOf('function commentSheet()'), app.indexOf('function batonSheet()'));
  assert.match(activity, /activityProfileButton/);
  assert.match(app, /function activityProfileButton[^]*data-friend-profile/);
  assert.match(updates, /update-activity-row[^]*data-friend-profile/);
  assert.match(comments, /data-friend-profile/);
  assert.doesNotMatch(app, /function proofViewerSheet/);
});''',
)

replace_named_test(
    'test/mobile-polish-v2.test.mjs',
    'Squad defaults to Proofs and presents Proofs first',
    r'''test('Friends is a proof-only feed without persisted feed-tab state', () => {
  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress'));
  assert.match(friends, /filter\(\(activity\) => activity\.proofPath\)/);
  assert.doesNotMatch(app, /donezo\.squadFeed/);
  assert.doesNotMatch(app, /data-squad-feed/);
});''',
)
replace_named_test(
    'test/mobile-polish-v2.test.mjs',
    'proof cards include lazy thumbnail affordances',
    r'''test('proof cards lazy-load full inline media', () => {
  assert.match(app, /data-proof-image/);
  assert.match(app, /IntersectionObserver/);
  assert.match(css, /\.proof-media/);
  assert.match(css, /\.proof-media img\{[^}]*width:100%[^}]*height:auto[^}]*object-fit:contain/);
});''',
)

replace_named_test(
    'test/mobile-social-v2.test.mjs',
    'Squad uses a People sheet and truly separates activity from proofs',
    r'''test('Friends keeps proofs in-feed while activity moves to Updates', () => {
  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress'));
  const updates = app.slice(app.indexOf('function updatesList('), app.indexOf('function unseenUpdatesCount('));
  assert.match(friends, /data-people-open/);
  assert.match(friends, /filter\(\(activity\) => activity\.proofPath\)/);
  assert.doesNotMatch(friends, /squad-feed-tabs/);
  assert.doesNotMatch(friends, /data-squad-feed/);
  assert.match(updates, /filter\(\(activity\) => !activity\.proofPath\)/);
  assert.match(friends, /aria-label="Refresh Friends"/);
  assert.doesNotMatch(friends, />Refresh<\/button>/);
  assert.match(app, /function peopleSheet\(\)/);
  assert.match(app, /data-invite-from-people/);
  assert.match(app, /No habits today/);
  assert.match(app, /people:/);
});''',
)

replace_named_test(
    'test/polish-batch.test.mjs',
    'navigation state and scroll positions survive rerenders',
    r'''test('navigation state and scroll positions survive rerenders', () => {
  assert.match(app, /donezo\.activeTab/);
  assert.match(app, /PRIMARY_TABS\.includes\(requestedTab\) \? requestedTab : 'today'/);
  assert.match(app, /function setActiveTab\(nextTab\)/);
  assert.match(app, /if \(!habitId\) setActiveTab\('today'\)/);
  assert.match(app, /else if \(step === 3\) openCheckInAction\(\)/);
  assert.match(app, /createdCircleInvite = null; setActiveTab\('today'\)/);
  assert.doesNotMatch(app, /donezo\.squadFeed/);
  assert.match(app, /screenScroll/);
  assert.match(app, /restoreScreenScroll/);
});''',
)
replace_named_test(
    'test/polish-batch.test.mjs',
    'activity grouping and visual signatures avoid grouping proofs or comments',
    r'''test('legacy activity grouping remains domain-safe while Friends no longer groups its proof feed', () => {
  const grouped = groupSquadActivity([
    { checkInId: 'a', type: 'completed', userId: 'u1', habitTitle: 'Run', when: '2026-08-30T10:00:00Z' },
    { checkInId: 'b', type: 'completed', userId: 'u2', habitTitle: 'Run', when: '2026-08-30T09:57:00Z' },
    { checkInId: 'c', type: 'completed', userId: 'u3', habitTitle: 'Read', proofPath: 'proof.jpg', when: '2026-08-30T09:55:00Z' },
  ], []);
  assert.equal(grouped[0].type, 'grouped_checkin');
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[1].checkInId, 'c');
  const friends = slice('function friendsScreen()', 'function challengeProgress');
  const updates = slice('function updatesList(', 'function unseenUpdatesCount(');
  assert.doesNotMatch(friends, /groupSquadActivity/);
  assert.match(updates, /filter\(\(activity\) => !activity\.proofPath\)/);
});''',
)
replace_named_test(
    'test/polish-batch.test.mjs',
    'empty states are actionable and loading uses stable skeletons',
    r'''test('new proof and Updates empty states stay actionable and explicit', () => {
  assert.match(app, /empty-action/);
  assert.match(app, /No proofs yet/);
  assert.match(app, /Quiet right now/);
  assert.match(app, /data-empty-checkin/);
  assert.match(social, /\.proof-media\.is-error/);
});''',
)
