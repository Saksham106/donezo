from pathlib import Path

app_path = Path('src/app.js')
css_path = Path('social.css')
text = app_path.read_text()
css = css_path.read_text()

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "let peopleSheetOpen = false;\nconst proofThumbnailUrls = new Map();",
    "let peopleSheetOpen = false;\nlet peopleSearchQuery = '';\nlet peopleSearchResults = [];\nlet peopleSearchLoading = false;\nlet peopleSuggestions = [];\nlet peopleSuggestionsLoading = false;\nlet peopleSearchRequestId = 0;\nlet peopleSuggestionsRequestId = 0;\nlet peopleSearchDebounceTimer = null;\nconst proofThumbnailUrls = new Map();",
    'People transient state',
)

replace_once(
    "  const peopleButton = `<button class=\"invite-icon-btn\" type=\"button\" data-people-open aria-label=\"View friends\" title=\"Friends\">${icon('people')}</button>`;",
    "  const incomingRequests = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId).length;\n  const peopleButton = `<button class=\"invite-icon-btn people-entry-btn\" type=\"button\" data-people-open aria-label=\"View friends\" title=\"Friends\">${icon('people')}${incomingRequests ? `<span class=\"people-request-badge\">${incomingRequests > 9 ? '9+' : incomingRequests}</span>` : ''}</button>`;",
    'Friends request badge',
)

start = text.index('function peopleSheet() {')
end = text.index('\nfunction checkInUndoSheet() {', start)
people_block = r'''function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Friends</button>';
  if (person.relationship === 'outgoing') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Requested</button>';
  if (person.relationship === 'incoming') return `<button class="btn primary small-btn" type="button" data-people-accept="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Accept</button>`;
  return `<button class="btn primary small-btn" type="button" data-people-add="${esc(person.id)}">Add</button>`;
}

function peoplePersonRow(person) {
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  const mutualCopy = mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : '';
  const avatar = person.avatarUrl
    ? `<img src="${esc(person.avatarUrl)}" alt="">`
    : esc(person.avatar || String(person.name || '?').slice(0, 1).toUpperCase());
  return `<article class="people-discovery-row"><button class="people-discovery-identity" type="button" data-people-person="${esc(person.id)}"><span class="avatar">${avatar}</span><span class="people-discovery-meta"><strong>${esc(person.name || 'Donezo user')}</strong>${handle ? `<small>${esc(handle)}</small>` : ''}${mutualCopy ? `<small>${esc(mutualCopy)}</small>` : ''}</span></button>${peopleRelationshipAction(person)}</article>`;
}

function peopleSheet() {
  if (!peopleSheetOpen || friendProfileUserId || inviteSheetOpen) return '';
  const state = getState();
  const normalizedQuery = peopleSearchQuery.trim().replace(/^@/, '').toLowerCase();
  const searching = normalizedQuery.length >= 2;
  const incoming = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId);
  const requestPeople = incoming.map((request) => {
    const profile = member(request.requesterId) || {};
    return {
      id: request.requesterId,
      name: profile.name || 'Donezo user',
      username: profile.username || String(profile.handle || '').replace(/^@/, ''),
      handle: profile.handle || (profile.username ? `@${profile.username}` : ''),
      avatar: profile.avatar || '?',
      avatarUrl: profile.avatarUrl || null,
      relationship: 'incoming',
      requestId: request.id,
      mutualCount: 0,
    };
  });
  const friends = friendList(state).filter((person) => person.id !== state.currentUserId).map((person) => ({
    ...person,
    username: person.username || String(person.handle || '').replace(/^@/, ''),
    relationship: 'friend',
    requestId: null,
    mutualCount: 0,
  }));
  const requestsSection = requestPeople.length
    ? `<section class="people-section"><div class="people-section-head"><h3>Requests</h3><span>${requestPeople.length}</span></div>${requestPeople.map(peoplePersonRow).join('')}</section>`
    : '';
  const suggestionsSection = peopleSuggestionsLoading
    ? '<section class="people-section"><div class="people-section-head"><h3>Suggested for you</h3></div><div class="people-search-loading">Finding people you may know…</div></section>'
    : peopleSuggestions.length
      ? `<section class="people-section"><div class="people-section-head"><h3>Suggested for you</h3></div>${peopleSuggestions.map(peoplePersonRow).join('')}</section>`
      : '';
  const friendsSection = friends.length
    ? `<section class="people-section"><div class="people-section-head"><h3>Friends</h3><span>${friends.length}</span></div>${friends.map(peoplePersonRow).join('')}</section>`
    : '';
  const defaultContent = `${requestsSection}${suggestionsSection}${friendsSection}<div class="people-growth-actions"><button class="btn full people-invite" type="button" data-invite-from-people ${friendInvitePreparing ? 'disabled aria-busy="true"' : ''}>${icon('userPlus')} ${friendInvitePreparing ? 'Preparing…' : 'Share invite'}</button><button class="text-btn people-invite-fallback" type="button" data-add-friend-from-people>Have an invite code?</button></div>`;
  const searchContent = peopleSearchLoading
    ? '<div class="people-search-loading">Searching…</div>'
    : peopleSearchResults.length
      ? `<div class="people-search-results">${peopleSearchResults.map(peoplePersonRow).join('')}</div>`
      : '<div class="empty compact-empty people-search-empty"><b>No people found.</b><p>Try their @username or display name.</p></div>';
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet people-sheet people-flow-sheet" role="dialog" aria-modal="true" aria-label="People" data-sheet><div class="sheet-handle"></div><div class="sheet-head people-sheet-head"><div><p class="eyebrow">FRIENDS</p><h2>People</h2></div><div class="people-head-actions"><button class="icon-btn" type="button" data-invite-from-people aria-label="Share invite">${icon('userPlus')}</button><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div></div><div class="people-search-shell"><label class="people-search"><span aria-hidden="true">⌕</span><input name="peopleSearch" type="search" placeholder="Search people" value="${esc(peopleSearchQuery)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label></div><div class="people-discovery-body">${searching ? searchContent : defaultContent}</div></section></div>`;
}

function closePeopleSheet() {
  peopleSheetOpen = false;
  peopleSearchQuery = '';
  peopleSearchResults = [];
  peopleSearchLoading = false;
  peopleSuggestions = [];
  peopleSuggestionsLoading = false;
  clearTimeout(peopleSearchDebounceTimer);
  peopleSearchDebounceTimer = null;
  peopleSearchRequestId += 1;
  peopleSuggestionsRequestId += 1;
  app.querySelector('.people-sheet')?.closest('.sheet-backdrop')?.remove();
}

function preservePeopleSearchFocus(callback) {
  const input = app.querySelector('.people-sheet [name="peopleSearch"]');
  const focused = document.activeElement === input;
  const start = input?.selectionStart ?? null;
  const end = input?.selectionEnd ?? null;
  callback();
  if (!focused) return;
  const next = app.querySelector('.people-sheet [name="peopleSearch"]');
  next?.focus({ preventScroll: true });
  if (start !== null && end !== null) next?.setSelectionRange?.(start, end);
}

function refreshPeopleSheet() {
  if (!peopleSheetOpen) return;
  const current = app.querySelector('.people-sheet')?.closest('.sheet-backdrop');
  if (!current) return;
  preservePeopleSearchFocus(() => {
    current.insertAdjacentHTML('afterend', peopleSheet());
    current.remove();
    bindPeopleSheetActions();
  });
}

function patchPeopleRequestBadge() {
  const state = getState();
  const count = (state.friendRequests || []).filter((request) => request.status === 'pending' && request.addresseeId === state.currentUserId).length;
  const button = app.querySelector('[data-people-open]');
  if (!button) return;
  button.querySelector('.people-request-badge')?.remove();
  if (!count) return;
  button.insertAdjacentHTML('beforeend', `<span class="people-request-badge">${count > 9 ? '9+' : count}</span>`);
}

function syncPeopleRelationship(userId, relationship, requestId = null) {
  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: requestId ?? person.requestId ?? null } : person;
  peopleSearchResults = peopleSearchResults.map(patch);
  peopleSuggestions = peopleSuggestions.map(patch);
}

async function handlePeopleAdd(userId) {
  if (!userId) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  syncPeopleRelationship(userId, 'outgoing');
  refreshPeopleSheet();
  try {
    const request = await repo.inviteFriend(userId);
    syncPeopleRelationship(userId, 'outgoing', request?.id || null);
    scheduleStateCacheWrite();
    notify('Friend request sent.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}

async function handlePeopleAccept(requestId, userId) {
  if (!requestId) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  if (userId) syncPeopleRelationship(userId, 'friend', null);
  refreshPeopleSheet();
  try {
    await repo.acceptFriend(requestId);
    if (userId) syncPeopleRelationship(userId, 'friend', null);
    scheduleStateCacheWrite();
    patchPeopleRequestBadge();
    notify('Friend added.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}

function queuePeopleSearch(rawQuery) {
  peopleSearchQuery = String(rawQuery || '');
  clearTimeout(peopleSearchDebounceTimer);
  const normalized = peopleSearchQuery.trim().replace(/^@/, '').toLowerCase();
  peopleSearchRequestId += 1;
  const requestId = peopleSearchRequestId;
  if (normalized.length < 2) {
    peopleSearchResults = [];
    peopleSearchLoading = false;
    refreshPeopleSheet();
    return;
  }
  peopleSearchLoading = true;
  refreshPeopleSheet();
  peopleSearchDebounceTimer = setTimeout(async () => {
    try {
      const results = await repo.searchPeople(normalized);
      if (requestId !== peopleSearchRequestId || !peopleSheetOpen) return;
      peopleSearchResults = results;
    } catch (error) {
      if (requestId !== peopleSearchRequestId) return;
      notify(readableError(error), 3600);
    } finally {
      if (requestId === peopleSearchRequestId && peopleSheetOpen) {
        peopleSearchLoading = false;
        refreshPeopleSheet();
      }
    }
  }, 250);
}

async function loadPeopleSuggestions() {
  const requestId = ++peopleSuggestionsRequestId;
  peopleSuggestionsLoading = true;
  refreshPeopleSheet();
  try {
    const suggestions = await repo.suggestPeople(10);
    if (requestId !== peopleSuggestionsRequestId || !peopleSheetOpen) return;
    peopleSuggestions = suggestions;
  } catch (error) {
    if (requestId !== peopleSuggestionsRequestId) return;
    peopleSuggestions = [];
    notify(readableError(error), 3600);
  } finally {
    if (requestId === peopleSuggestionsRequestId && peopleSheetOpen) {
      peopleSuggestionsLoading = false;
      refreshPeopleSheet();
    }
  }
}

function openAddFriendFromPeople() {
  closePeopleSheet();
  inviteMessage = '';
  addFriendSheetOpen = true;
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', addFriendSheet());
  const backdrop = app.querySelector('.add-friend-sheet')?.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target !== backdrop) return;
    addFriendSheetOpen = false;
    backdrop.remove();
  });
  app.querySelector('.add-friend-sheet [data-close-add-friend]')?.addEventListener('click', () => {
    addFriendSheetOpen = false;
    backdrop?.remove();
    openPeopleSheet();
  });
  app.querySelector('.add-friend-sheet #join-friend-form')?.addEventListener('submit', handleJoinCircle);
  bindSheetSwipeDismiss();
}

function bindPeopleSheetActions() {
  const sheet = app.querySelector('.people-sheet');
  if (!sheet) return;
  const backdrop = sheet.closest('.sheet-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closePeopleSheet();
  });
  sheet.querySelector('[data-close-people]')?.addEventListener('click', closePeopleSheet);
  sheet.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = handleShareInvite; });
  sheet.querySelector('[data-add-friend-from-people]')?.addEventListener('click', openAddFriendFromPeople);
  sheet.querySelector('[name="peopleSearch"]')?.addEventListener('input', (event) => queuePeopleSearch(event.target.value));
  sheet.querySelectorAll('[data-people-add]').forEach((element) => { element.onclick = () => handlePeopleAdd(element.dataset.peopleAdd); });
  sheet.querySelectorAll('[data-people-accept]').forEach((element) => { element.onclick = () => handlePeopleAccept(element.dataset.peopleAccept, element.dataset.peopleUser); });
  sheet.querySelectorAll('[data-people-person]').forEach((element) => { element.onclick = () => {
    const person = [...peopleSearchResults, ...peopleSuggestions].find((item) => item.id === element.dataset.peoplePerson)
      || friendList(getState()).find((item) => item.id === element.dataset.peoplePerson);
    if (person?.relationship === 'friend' || friendList(getState()).some((item) => item.id === element.dataset.peoplePerson)) openFriendProfile(element.dataset.peoplePerson);
  }; });
  bindSheetSwipeDismiss();
}

function openPeopleSheet() {
  if (peopleSheetOpen && app.querySelector('.people-sheet')) return;
  peopleSheetOpen = true;
  peopleSearchQuery = '';
  peopleSearchResults = [];
  peopleSearchLoading = false;
  peopleSuggestions = [];
  peopleSuggestionsLoading = false;
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', peopleSheet());
  bindPeopleSheetActions();
  void primeFriendInvite();
  void loadPeopleSuggestions();
}
'''
text = text[:start] + people_block + text[end:]

replace_once(
    "  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = () => { peopleSheetOpen = true; void primeFriendInvite(); render(); }; });",
    "  app.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = openPeopleSheet; });",
    'People open binding',
)

replace_once(
    "  app.querySelectorAll('[data-close-habit], [data-close-nudge], [data-close-inbox], [data-close-people], [data-close-add-friend], [data-close-social-sheet]').forEach((element) => { element.onclick = () => { closeSheets(); render(); }; });",
    "  app.querySelectorAll('[data-close-habit], [data-close-nudge], [data-close-inbox], [data-close-add-friend], [data-close-social-sheet]').forEach((element) => { element.onclick = () => { closeSheets(); render(); }; });",
    'People excluded from global close binding',
)

replace_once(
    "        if (sheet.classList.contains('comment-sheet')) {\n          closeCommentSheet();\n          return;\n        }",
    "        if (sheet.classList.contains('comment-sheet')) {\n          closeCommentSheet();\n          return;\n        }\n        if (sheet.classList.contains('people-sheet')) {\n          closePeopleSheet();\n          return;\n        }",
    'People swipe close',
)

# On full app renders (navigation, background state changes, etc.), a People
# sheet already present in the generated shell still needs its local handlers.
replace_once(
    "  bindSheetSwipeDismiss();\n  const habitForm = app.querySelector('#habit-form');",
    "  bindPeopleSheetActions();\n  bindSheetSwipeDismiss();\n  const habitForm = app.querySelector('#habit-form');",
    'People render binding',
)

replace_once(
    "  peopleSheetOpen = false;\n  commentCheckInId = null;",
    "  peopleSheetOpen = false;\n  clearTimeout(peopleSearchDebounceTimer);\n  peopleSearchDebounceTimer = null;\n  peopleSearchRequestId += 1;\n  peopleSuggestionsRequestId += 1;\n  peopleSearchQuery = '';\n  peopleSearchResults = [];\n  peopleSearchLoading = false;\n  peopleSuggestions = [];\n  peopleSuggestionsLoading = false;\n  commentCheckInId = null;",
    'People closeSheets reset',
)

css += r'''

/* Searchable People discovery */
.people-entry-btn{position:relative}.people-request-badge{position:absolute;top:-.32rem;right:-.32rem;display:grid;place-items:center;min-width:1.08rem;height:1.08rem;padding:0 .2rem;border:2px solid var(--color-paper);border-radius:var(--radius-round);background:var(--color-coral);color:white;font-family:var(--font-mono);font-size:.58rem;font-weight:900;line-height:1}.people-sheet.people-flow-sheet{height:min(88dvh,48rem);max-height:calc(100dvh - env(safe-area-inset-top) - .75rem);display:flex;flex-direction:column;padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom));overflow:hidden}.people-sheet-head{flex:0 0 auto}.people-head-actions{display:flex;align-items:center;gap:var(--space-2)}.people-search-shell{position:sticky;top:0;z-index:2;flex:0 0 auto;margin:0 calc(var(--space-1) * -1);padding:0 var(--space-1) var(--space-3);background:var(--color-paper)}.people-search{display:flex;align-items:center;gap:.5rem;min-height:2.9rem;padding:0 .8rem;border:var(--rule-hairline) solid var(--color-rule-strong);border-radius:var(--radius-round);background:var(--color-surface)}.people-search>span{color:var(--color-muted);font-size:1.1rem}.people-search input{width:100%;min-height:2.6rem;padding:0;border:0;outline:0;background:transparent;color:var(--color-ink);font:inherit}.people-search input::-webkit-search-cancel-button{opacity:.65}.people-discovery-body{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;padding-bottom:var(--space-2);scrollbar-width:none}.people-discovery-body::-webkit-scrollbar{display:none}.people-section{padding:var(--space-2) 0 var(--space-3);border-bottom:var(--rule-hairline) solid var(--color-rule)}.people-section:last-of-type{border-bottom:0}.people-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:.25rem .15rem var(--space-2)}.people-section-head h3{margin:0;font-size:var(--text-sm);font-weight:850}.people-section-head span{color:var(--color-muted);font-family:var(--font-mono);font-size:var(--text-xs)}.people-discovery-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--space-2);min-height:3.8rem;padding:.38rem .05rem}.people-discovery-identity{display:flex;align-items:center;gap:.72rem;width:100%;min-height:3.2rem;padding:0;border:0;background:transparent;color:var(--color-ink);text-align:left}.people-discovery-identity .avatar{flex:0 0 auto;overflow:hidden}.people-discovery-identity .avatar img{width:100%;height:100%;object-fit:cover}.people-discovery-meta{display:block;min-width:0}.people-discovery-meta strong,.people-discovery-meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.people-discovery-meta strong{font-size:var(--text-sm)}.people-discovery-meta small{margin-top:.08rem;color:var(--color-muted);font-size:var(--text-2xs)}.people-relationship-state{color:var(--color-muted);opacity:.78}.people-search-loading{padding:var(--space-6) var(--space-3);color:var(--color-muted);font-size:var(--text-sm);text-align:center}.people-search-results{display:grid}.people-search-empty{margin-top:var(--space-4)}.people-growth-actions{display:grid;grid-template-columns:1fr;gap:var(--space-1);padding:var(--space-4) 0 var(--space-2)}.people-invite-fallback{width:100%;min-height:2.6rem}.people-sheet .people-invite{width:100%}
@media(max-width:374px){.people-sheet.people-flow-sheet{height:min(90dvh,46rem)}.people-discovery-row{gap:.4rem}.people-discovery-row>.btn{padding-inline:.62rem}.people-discovery-meta small{max-width:12rem}}
'''

app_path.write_text(text)
css_path.write_text(css)
