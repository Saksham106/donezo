import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, value) => writeFile(path, value, 'utf8');

function requireOnce(source, needle, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
}

function replaceOnce(source, needle, replacement, label) {
  requireOnce(source, needle, label);
  return source.replace(needle, replacement);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker missing`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function indentFunction(source, spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return source.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function replaceIndentedFunction(source, signature, replacement, label) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`${label}: function signature missing`);
  const searchFrom = start + signature.length;
  const candidates = ['\n\n  function ', '\n\n  async function ', '\n\n  return {']
    .map((marker) => source.indexOf(marker, searchFrom))
    .filter((index) => index >= 0);
  if (!candidates.length) throw new Error(`${label}: next peer declaration missing`);
  const end = Math.min(...candidates);
  return `${source.slice(0, start)}${indentFunction(replacement)}${source.slice(end)}`;
}

function proofReplyPreview(checkInId) {
  const comments = (getState()?.comments || [])
    .filter((comment) => comment.checkInId === checkInId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (!comments.length) return '';
  const visible = comments.slice(-2);
  const rows = visible.map((comment) => {
    const author = member(comment.authorId);
    const label = comment.authorId === getState()?.currentUserId
      ? 'You'
      : (author?.handle || author?.name || 'Friend');
    return `<div class="proof-reply-row"><button class="proof-reply-author" type="button" data-friend-profile="${comment.authorId}" aria-label="Open ${esc(author?.name || 'friend')} profile">${esc(label)}</button><span>${esc(comment.body)}</span></div>`;
  }).join('');
  const more = comments.length > 2
    ? `<button class="proof-reply-all" type="button" data-comment-open="${checkInId}">View all ${comments.length} replies</button>`
    : '';
  return `<div class="proof-reply-preview">${rows}${more}</div>`;
}

function patchedActivityCard(activity, { showProofActions = false } = {}) {
  const actor = member(activity.userId);
  const mine = activity.userId === me().id;
  if (activity.type === 'callout') {
    const target = member(activity.toUserId);
    return `<article class="activity callout"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')} called out ${esc(target?.name || 'a friend')}`, `${esc(formatWhen(activity.when))} · visible to this group`)}</div><div class="callout-message"><span>⚡</span><p>${esc(activity.message)}</p></div></article>`;
  }
  if (['missed', 'recovered', 'recovery'].includes(activity.type)) {
    const recovered = activity.type === 'recovered';
    const missed = activity.type === 'missed';
    const verb = missed ? 'missed one' : recovered ? 'came back' : 'made a recovery move';
    return `<article class="activity ${activity.type}"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')} ${verb}`, esc(formatWhen(activity.when)))}</div><div class="activity-body"><span>${missed ? '○' : '↩'}</span><div><strong>${esc(activity.emoji)} ${esc(activity.habitTitle)}</strong><p>${esc(activity.message)}</p></div></div>${!mine && !missed ? `<button class="btn small-btn" data-nudge="${activity.userId}">Send support</button>` : ''}</article>`;
  }
  const checkIn = getState().checkIns.find((item) => item.id === activity.checkInId);
  const threshold = proofRejectionThreshold(friendList(getState()).length);
  const proofPreview = showProofActions && activity.proofPath ? `<button class="proof-thumbnail" type="button" data-proof="${esc(activity.proofPath)}" data-proof-thumbnail="${esc(activity.proofPath)}" aria-label="Open ${esc(activity.habitTitle)} proof"><span aria-hidden="true">📷</span><small>Loading proof…</small></button>` : '';
  const proofActions = showProofActions && activity.proofPath ? `<div class="proof-actions"><button class="btn proof-btn" data-proof="${esc(activity.proofPath)}">Open proof</button>${mine ? (activity.invalid ? `<button class="btn danger-soft" data-redo-checkin="${activity.checkInId}">Run it back</button>` : '') : `<button class="vote-btn ${activity.userDownvoted ? 'active' : ''}" data-request-reject="${activity.checkInId}" aria-label="${activity.userDownvoted ? 'Remove proof rejection' : 'Reject proof'}">👎 <span>${activity.downvotes || 0}${Number.isFinite(threshold) ? `/${threshold}` : ''}</span></button>`}</div>` : '';
  const commentCount = (getState().comments || []).filter((comment) => comment.checkInId === activity.checkInId).length;
  const mineReactions = (activity.userReactions || []).slice(-1);
  const visibleReactionCounts = { ...(activity.reactionCounts || {}) };
  mineReactions.forEach((emoji) => {
    visibleReactionCounts[emoji] = Math.max(1, Number(visibleReactionCounts[emoji] || 0));
  });
  const reactionTotal = Object.values(visibleReactionCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const reactionSummary = mineReactions.length
    ? `You reacted ${mineReactions[0]} · ${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}`
    : reactionTotal ? `${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}` : 'Be the first to hype this';
  const positiveReactions = `<div class="activity-social-actions"><div><div class="reaction-row" aria-label="React to this check-in">${['👏', '🔥', '💪', '😂'].map((emoji) => { const active = mineReactions.includes(emoji); return `<button type="button" class="reaction-btn ${active ? 'active' : ''}" data-reaction="${activity.checkInId}" data-reaction-emoji="${emoji}" aria-label="React ${emoji}" aria-pressed="${active}">${emoji}<span>${visibleReactionCounts[emoji] || 0}</span></button>`; }).join('')}</div><small class="reaction-summary" aria-live="polite">${esc(reactionSummary)}</small></div><button type="button" class="comment-open" data-comment-open="${activity.checkInId}">${commentCount ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</button></div>`;
  const activityMessage = activity.message === 'Done. Proof beats promises.' ? '' : activity.message;
  if (activity.proofPath) {
    const actorLabel = mine ? 'You' : esc(actor?.name || 'Friend');
    const actorHandle = !mine && actor?.handle ? ` ${esc(actor.handle)}` : '';
    const invalidLabel = activity.invalid ? ' · cooked 💀' : '';
    return `<article class="activity proof-activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="proof-card-header"><div class="proof-card-title"><span aria-hidden="true">${esc(activity.emoji)}</span><strong>${esc(activity.habitTitle)}</strong></div><div class="proof-card-byline"><button class="proof-card-author" type="button" data-friend-profile="${activity.userId}" aria-label="Open ${esc(actor?.name || 'friend')} profile">${actorLabel}${actorHandle}${invalidLabel}</button><span>· ${esc(formatWhen(activity.when))}</span><span>· 🔥 ${activity.streak}</span></div></div>${proofPreview}${activityMessage ? `<p class="proof-card-note">${esc(activityMessage)}</p>` : ''}${proofActions}${positiveReactions}${proofReplyPreview(activity.checkInId)}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
  }
  return `<article class="activity ${activity.invalid ? 'invalid' : ''}" data-check-in="${activity.checkInId}"><div class="activity-head">${activityProfileButton(activity.userId, `${mine ? 'You' : esc(actor?.name || 'Friend')}${activity.invalid ? ' · cooked 💀' : ''}`, `${esc(formatWhen(activity.when))} · 🔥 ${activity.streak}`)}</div><div class="activity-body"><span>${esc(activity.emoji)}</span><div><strong>${esc(activity.habitTitle)}</strong>${activityMessage ? `<p>${esc(activityMessage)}</p>` : ''}</div></div>${proofPreview}${proofActions}${positiveReactions}${checkIn?.invalid ? '<p class="proof-verdict">Does not count toward streaks or League.</p>' : ''}</article>`;
}

function bindSheetSwipeDismiss() {
  app.querySelectorAll('[data-sheet]').forEach((sheet) => {
    if (sheet.classList.contains('wrapped-sheet') || sheet.dataset.swipeDismissBound === 'true') return;
    const backdrop = sheet.closest('.sheet-backdrop');
    if (!backdrop) return;
    sheet.dataset.swipeDismissBound = 'true';
    let tracking = false;
    let startY = 0;
    let startAt = 0;
    let dragY = 0;
    let startedFromHandle = false;

    const resetVisuals = () => {
      sheet.classList.remove('is-dragging');
      backdrop.classList.remove('is-dragging');
      sheet.style.removeProperty('transform');
      backdrop.style.removeProperty('--sheet-backdrop-alpha');
    };

    sheet.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      const target = event.target;
      const fromHandle = Boolean(target.closest('.sheet-handle, .sheet-head'));
      if (target.closest('input, textarea, select, button, a, label, [contenteditable="true"]')) return;
      if (!fromHandle && sheet.scrollTop > 0) return;
      tracking = true;
      startedFromHandle = fromHandle;
      startY = event.touches[0].clientY;
      startAt = performance.now();
      dragY = 0;
    }, { passive: true });

    sheet.addEventListener('touchmove', (event) => {
      if (!tracking || event.touches.length !== 1) return;
      if (!startedFromHandle && sheet.scrollTop > 0) {
        tracking = false;
        resetVisuals();
        return;
      }
      const deltaY = event.touches[0].clientY - startY;
      if (deltaY <= 0) {
        dragY = 0;
        resetVisuals();
        return;
      }
      dragY = deltaY;
      sheet.classList.add('is-dragging');
      backdrop.classList.add('is-dragging');
      sheet.style.transform = `translate3d(0, ${dragY}px, 0)`;
      backdrop.style.setProperty('--sheet-backdrop-alpha', String(Math.max(0.18, 0.42 - Math.min(0.24, dragY / 650))));
      event.preventDefault();
    }, { passive: false });

    const finish = () => {
      if (!tracking) return;
      const elapsed = Math.max(1, performance.now() - startAt);
      const velocity = dragY / elapsed;
      const shouldClose = dragY >= 96 || (dragY >= 36 && velocity >= 0.55);
      tracking = false;
      if (shouldClose) {
        resetVisuals();
        closeSheets();
        render();
        return;
      }
      resetVisuals();
    };

    sheet.addEventListener('touchend', finish, { passive: true });
    sheet.addEventListener('touchcancel', () => {
      tracking = false;
      resetVisuals();
    }, { passive: true });
  });
}

function memoryToggleReaction(checkInId, emoji) {
  if (!['👏', '🔥', '💪', '😂'].includes(emoji)) throw new Error('Choose a supported reaction');
  const checkIn = state.checkIns.find((item) => item.id === checkInId);
  if (!checkIn) throw new Error('That update is no longer available');
  const positiveReactions = (state.reactions || []).filter((reaction) => reaction.checkInId === checkInId && reaction.userId === state.currentUserId && reaction.emoji !== '👎');
  const selected = positiveReactions.length === 1 && positiveReactions[0].emoji === emoji;
  state.reactions = (state.reactions || []).filter((reaction) => !(reaction.checkInId === checkInId && reaction.userId === state.currentUserId && reaction.emoji !== '👎'));
  if (!selected) state.reactions.push({ id: uid('reaction'), checkInId, userId: state.currentUserId, emoji, createdAt: new Date().toISOString() });
  return clone(state);
}

async function supabaseToggleReaction(checkInId, emoji) {
  if (!['👏', '🔥', '💪', '😂'].includes(emoji)) throw new Error('Choose a supported reaction');
  const checkIn = state.checkIns.find((item) => item.id === checkInId);
  if (!checkIn) throw new Error('That update is no longer available');
  const positiveReactions = state.reactions.filter((reaction) => reaction.checkInId === checkInId && reaction.userId === user.id && reaction.emoji !== '👎');
  const selected = positiveReactions.length === 1 && positiveReactions[0].emoji === emoji;
  const { error: deleteError } = await client.from('reactions').delete().eq('check_in_id', checkInId).eq('user_id', user.id).neq('emoji', '👎');
  if (deleteError) throw appError(deleteError, 'Could not update reaction');
  if (!selected) {
    const { error: insertError } = await client.from('reactions').insert({ check_in_id: checkInId, user_id: user.id, emoji });
    if (insertError) throw appError(insertError, 'Could not react');
  }
  return load();
}

let app = await read('src/app.js');
const friendActions = '<div class="friends-action-row"><button class="btn primary" type="button" data-invite-open>${icon(\'userPlus\')} Invite</button><button class="btn" type="button" data-add-friend-open>Add by link</button></div>';
app = replaceOnce(app, friendActions, '', 'remove parent Friends actions');

const peopleFooter = '<div class="people-list">${rows}</div><button class="btn primary full people-invite" type="button" data-invite-from-people>${icon(\'userPlus\')} Invite friends</button>';
const newPeopleFooter = '<div class="people-list">${rows}</div><div class="people-growth-actions"><button class="btn primary full people-invite" type="button" data-invite-from-people>${icon(\'userPlus\')} Invite friends</button><button class="btn full" type="button" data-add-friend-from-people>Add by link</button></div>';
app = replaceOnce(app, peopleFooter, newPeopleFooter, 'move friend growth actions into People sheet');

const inviteBinding = "  app.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; inviteSheetOpen = true; render(); }; });";
app = replaceOnce(app, inviteBinding, `${inviteBinding}\n  app.querySelectorAll('[data-add-friend-from-people]').forEach((element) => { element.onclick = () => { peopleSheetOpen = false; inviteMessage = ''; addFriendSheetOpen = true; render(); }; });`, 'bind Add by link from People sheet');

const activityReplacement = `${proofReplyPreview.toString()}\n\n${patchedActivityCard.toString().replace('patchedActivityCard', 'activityCard')}\n`;
app = replaceRange(app, 'function activityCard(', '\nfunction personProofCarousel(', activityReplacement, 'replace proof activity card');

app = replaceOnce(app, '\nfunction closeSheets() {', `\n${bindSheetSwipeDismiss.toString()}\n\nfunction closeSheets() {`, 'insert swipe dismiss helper');
app = replaceOnce(app, "\n  const habitForm = app.querySelector('#habit-form');", "\n  bindSheetSwipeDismiss();\n  const habitForm = app.querySelector('#habit-form');", 'initialize swipe dismiss after render');
await write('src/app.js', app);

let store = await read('src/store.js');
const memoryStart = store.indexOf('export function createMemoryRepository');
const supabaseStart = store.indexOf('export function createSupabaseRepository');
if (memoryStart < 0 || supabaseStart < 0 || memoryStart >= supabaseStart) throw new Error('repository block markers missing');
let memoryBlock = store.slice(memoryStart, supabaseStart);
if (!memoryBlock.includes('function toggleReaction(checkInId, emoji)')) {
  const insertionMarkers = ['\n  function recoverHabit', '\n  function createChallenge', '\n  function sendNudge'];
  const marker = insertionMarkers.find((candidate) => memoryBlock.includes(candidate));
  if (!marker) throw new Error('memory reaction insertion marker missing');
  memoryBlock = replaceOnce(memoryBlock, marker, `\n${indentFunction(memoryToggleReaction.toString().replace('memoryToggleReaction', 'toggleReaction'))}\n${marker}`, 'insert memory toggleReaction');
}
if (!memoryBlock.includes('    toggleReaction,')) {
  const exportMarkers = ['    toggleDownvote,\n', '    completeWithProof,\n', '    toggleHabit,\n'];
  const marker = exportMarkers.find((candidate) => memoryBlock.includes(candidate));
  if (!marker) throw new Error('memory reaction export marker missing');
  memoryBlock = replaceOnce(memoryBlock, marker, `${marker}    toggleReaction,\n`, 'export memory toggleReaction');
}
store = `${store.slice(0, memoryStart)}${memoryBlock}${store.slice(supabaseStart)}`;
store = replaceIndentedFunction(store, '  async function toggleReaction(checkInId, emoji) {', supabaseToggleReaction.toString().replace('supabaseToggleReaction', 'toggleReaction'), 'replace Supabase toggleReaction');
await write('src/store.js', store);

let styles = await read('styles.css');
if (!styles.includes('/* Touch-native app selection behavior. */')) {
  styles += `\n/* Touch-native app selection behavior. */\n@media (pointer: coarse){#app,#app *{-webkit-user-select:none;user-select:none}#app input,#app textarea,#app [contenteditable="true"]{-webkit-user-select:text;user-select:text}}\n`;
}
await write('styles.css', styles);

let social = await read('social.css');
if (!social.includes('/* Mobile proof hierarchy and sheet gestures. */')) {
  social += `\n/* Mobile proof hierarchy and sheet gestures. */\n.people-growth-actions{display:grid;gap:var(--space-2);margin-top:var(--space-4)}\n.proof-card-header{margin-bottom:var(--space-3)}.proof-card-title{display:flex;align-items:center;gap:var(--space-2);min-width:0}.proof-card-title>span{flex:0 0 auto;font-size:1.2rem}.proof-card-title strong{min-width:0;overflow-wrap:anywhere;font-family:var(--font-display);font-size:var(--text-lg);font-weight:800;letter-spacing:-.025em;line-height:1.15}.proof-card-byline{display:flex;align-items:center;flex-wrap:wrap;gap:.28rem;margin-top:.32rem;color:var(--color-muted);font-size:var(--text-xs);line-height:1.35}.proof-card-author{min-height:0;border:0;padding:0;background:transparent;color:inherit;font-size:inherit;font-weight:750;text-align:left}.proof-card-note{margin:var(--space-3) 0 0;color:var(--color-muted);font-size:var(--text-sm);line-height:1.4}.proof-reply-preview{display:grid;gap:.38rem;margin-top:var(--space-3);padding-top:var(--space-3);border-top:var(--rule-hairline) solid var(--color-rule)}.proof-reply-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.4rem;align-items:baseline;font-size:var(--text-xs);line-height:1.4}.proof-reply-row>span{min-width:0;overflow-wrap:anywhere}.proof-reply-author,.proof-reply-all{min-height:0;border:0;padding:0;background:transparent;color:var(--color-ink);font-size:inherit;font-weight:800;text-align:left}.proof-reply-all{margin-top:.15rem;color:var(--color-muted);font-weight:700}.sheet-backdrop{--sheet-backdrop-alpha:.42;background:oklch(15% .02 258/var(--sheet-backdrop-alpha));transition:background var(--dur-base) var(--ease-out)}.sheet{transition:transform var(--dur-base) var(--ease-out)}.sheet.is-dragging,.sheet-backdrop.is-dragging{transition:none}.sheet.is-dragging{will-change:transform}.sheet-handle{touch-action:none}.sheet-head{touch-action:pan-x}@media(prefers-reduced-motion:reduce){.sheet,.sheet-backdrop{transition:none}}\n`;
}
await write('social.css', social);

let sw = await read('sw.js');
sw = replaceOnce(sw, "const CACHE = 'donezo-shell-v23';", "const CACHE = 'donezo-shell-v24';", 'bump service worker cache');
await write('sw.js', sw);

const migration = `-- Allow at most one positive reaction per person per proof while keeping proof rejection independent.\nwith ranked_positive_reactions as (\n  select\n    id,\n    row_number() over (\n      partition by check_in_id, user_id\n      order by created_at desc, id desc\n    ) as row_number\n  from public.reactions\n  where emoji <> '👎'\n)\ndelete from public.reactions reaction\nusing ranked_positive_reactions ranked\nwhere reaction.id = ranked.id\n  and ranked.row_number > 1;\n\ncreate unique index if not exists reactions_one_positive_per_user_checkin\n  on public.reactions(check_in_id, user_id)\n  where emoji <> '👎';\n`;
await write('supabase/migrations/0025_one_positive_reaction_per_proof.sql', migration);

let leagueTest = await read('test/league-friends-ux.test.mjs');
leagueTest = replaceRange(
  leagueTest,
  "test('Friends page owns Invite and Add by link while Settings no longer duplicates friend management', () => {",
  '\n});',
  `test('Friends list sheet owns Invite and Add by link while parent and Settings stay uncluttered', () => {\n  const friends = app.slice(app.indexOf('function friendsScreen()'), app.indexOf('function challengeProgress('));\n  const people = app.slice(app.indexOf('function peopleSheet()'), app.indexOf('function proofRejectSheet()'));\n  const settings = app.slice(app.indexOf('function settingsSheet()'), app.indexOf('function nudgeComposerSheet()'));\n  assert.doesNotMatch(friends, /data-invite-open|data-add-friend-open/);\n  assert.match(people, /data-invite-from-people/);\n  assert.match(people, /data-add-friend-from-people/);\n  assert.match(app, /function addFriendSheet\\(\\)/);\n  assert.doesNotMatch(settings, /data-settings-view="friends"/);\n  assert.doesNotMatch(settings, /join-friend-form/);`,
  'update Friends ownership regression',
);
await write('test/league-friends-ux.test.mjs', leagueTest);

let finalPolishTest = await read('test/final-social-polish.test.mjs');
finalPolishTest = replaceOnce(finalPolishTest, 'donezo-shell-v23', 'donezo-shell-v24', 'update service worker regression');
await write('test/final-social-polish.test.mjs', finalPolishTest);

console.log('Applied mobile social proof polish patch.');
