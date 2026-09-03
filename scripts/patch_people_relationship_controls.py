from pathlib import Path

APP = Path('src/app.js')
app = APP.read_text()

state_anchor = "let discoveryProfilePerson = null;\nconst proofThumbnailUrls = new Map();"
state_replacement = "let discoveryProfilePerson = null;\nlet friendRemovalPerson = null;\nconst proofThumbnailUrls = new Map();"
assert state_anchor in app
app = app.replace(state_anchor, state_replacement, 1)

relationship_anchor = "function peopleRelationshipAction(person) {"
removal_block = '''function friendRemovalSheet() {
  if (!friendRemovalPerson) return '';
  return `<div class="sheet-backdrop friend-removal-layer"><section class="sheet compact-sheet friend-removal-sheet" role="alertdialog" aria-modal="true" aria-label="Remove friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">FRIENDS</p><h2>Remove friend?</h2></div><button class="icon-btn" type="button" data-cancel-friend-removal aria-label="Keep friend">×</button></div><p class="sheet-copy">${esc(friendRemovalPerson.name || 'This friend')} will stop seeing future friend-only proofs. Historical proofs they were already allowed to see stay unchanged.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-friend-removal>Keep friend</button><button class="btn danger-soft" type="button" data-confirm-friend-removal>Remove friend</button></div></section></div>`;
}

function closeFriendRemovalSheet() {
  friendRemovalPerson = null;
  app.querySelector('.friend-removal-sheet')?.closest('.sheet-backdrop')?.remove();
}

async function handlePeopleRemoveFriend() {
  const person = friendRemovalPerson;
  if (!person?.id) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  syncPeopleRelationship(person.id, 'available', null);
  try {
    await repo.removeFriend(person.id);
    friendRemovalPerson = null;
    app.querySelector('.friend-removal-sheet')?.closest('.sheet-backdrop')?.remove();
    scheduleStateCacheWrite();
    notify('Friend removed.');
    refreshPeopleSheet();
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    syncPeopleRelationship(person.id, 'friend', null);
    notify(readableError(error), 3600);
    refreshPeopleSheet();
  }
}

'''
assert relationship_anchor in app
assert 'function friendRemovalSheet()' not in app
app = app.replace(relationship_anchor, removal_block + relationship_anchor, 1)

old_action = '''function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Friends</button>';
  if (person.relationship === 'outgoing') return '<button class="btn small-btn people-relationship-state" type="button" disabled>Requested</button>';
  if (person.relationship === 'incoming') return `<button class="btn primary small-btn" type="button" data-people-accept="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Accept</button>`;
  return `<button class="btn primary small-btn" type="button" data-people-add="${esc(person.id)}">Add</button>`;
}
'''
new_action = '''function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return `<button class="btn small-btn people-relationship-state" type="button" data-people-remove="${esc(person.id)}">Friends</button>`;
  if (person.relationship === 'outgoing') return `<button class="btn small-btn people-relationship-state" type="button" data-people-cancel="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Requested</button>`;
  if (person.relationship === 'incoming') return `<button class="btn primary small-btn" type="button" data-people-accept="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Accept</button>`;
  return `<button class="btn primary small-btn" type="button" data-people-add="${esc(person.id)}">Add</button>`;
}
'''
assert old_action in app
app = app.replace(old_action, new_action, 1)

old_close = '''  peopleSuggestionsLoading = false;
  discoveryProfilePerson = null;
  clearTimeout(peopleSearchDebounceTimer);'''
new_close = '''  peopleSuggestionsLoading = false;
  discoveryProfilePerson = null;
  friendRemovalPerson = null;
  app.querySelector('.friend-removal-sheet')?.closest('.sheet-backdrop')?.remove();
  clearTimeout(peopleSearchDebounceTimer);'''
assert old_close in app
app = app.replace(old_close, new_close, 1)

old_sync = '''function syncPeopleRelationship(userId, relationship, requestId = null) {
  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: requestId ?? person.requestId ?? null } : person;
  peopleSearchResults = peopleSearchResults.map(patch);
  peopleSuggestions = peopleSuggestions.map(patch);
  if (discoveryProfilePerson?.id === userId) discoveryProfilePerson = patch(discoveryProfilePerson);
}
'''
new_sync = '''function syncPeopleRelationship(userId, relationship, requestId) {
  const hasRequestId = arguments.length >= 3;
  const patch = (person) => person.id === userId
    ? { ...person, relationship, requestId: hasRequestId ? requestId : (person.requestId ?? null) }
    : person;
  peopleSearchResults = peopleSearchResults.map(patch);
  peopleSuggestions = peopleSuggestions.map(patch);
  if (discoveryProfilePerson?.id === userId) discoveryProfilePerson = patch(discoveryProfilePerson);
}
'''
assert old_sync in app
app = app.replace(old_sync, new_sync, 1)

accept_anchor = 'async function handlePeopleAccept(requestId, userId) {'
cancel_handler = '''async function handlePeopleCancel(requestId, userId) {
  if (!requestId || !userId) return;
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  syncPeopleRelationship(userId, 'available', null);
  refreshPeopleSheet();
  try {
    await repo.cancelFriendRequest(requestId);
    scheduleStateCacheWrite();
    notify('Friend request unsent.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}

'''
assert accept_anchor in app
assert 'async function handlePeopleCancel(' not in app
app = app.replace(accept_anchor, cancel_handler + accept_anchor, 1)

old_bind = '''  sheet.querySelectorAll('[data-people-add]').forEach((element) => { element.onclick = () => handlePeopleAdd(element.dataset.peopleAdd); });
  sheet.querySelectorAll('[data-people-accept]').forEach((element) => { element.onclick = () => handlePeopleAccept(element.dataset.peopleAccept, element.dataset.peopleUser); });
  sheet.querySelector('[data-people-discovery-back]')?.addEventListener('click', () => {'''
new_bind = '''  sheet.querySelectorAll('[data-people-add]').forEach((element) => { element.onclick = () => handlePeopleAdd(element.dataset.peopleAdd); });
  sheet.querySelectorAll('[data-people-cancel]').forEach((element) => { element.onclick = () => handlePeopleCancel(element.dataset.peopleCancel, element.dataset.peopleUser); });
  sheet.querySelectorAll('[data-people-accept]').forEach((element) => { element.onclick = () => handlePeopleAccept(element.dataset.peopleAccept, element.dataset.peopleUser); });
  sheet.querySelectorAll('[data-people-remove]').forEach((element) => { element.onclick = () => {
    const rawFriend = friendList(getState()).find((item) => item.id === element.dataset.peopleRemove);
    const person = [...peopleSearchResults, ...peopleSuggestions].find((item) => item.id === element.dataset.peopleRemove)
      || (rawFriend ? { ...rawFriend, relationship: 'friend' } : null);
    if (!person) return;
    friendRemovalPerson = { ...person };
    app.querySelector('.friend-removal-sheet')?.closest('.sheet-backdrop')?.remove();
    app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', friendRemovalSheet());
    const removalSheet = app.querySelector('.friend-removal-sheet');
    removalSheet?.querySelectorAll('[data-cancel-friend-removal]').forEach((button) => { button.onclick = closeFriendRemovalSheet; });
    removalSheet?.querySelector('[data-confirm-friend-removal]')?.addEventListener('click', () => { void handlePeopleRemoveFriend(); });
    const removalBackdrop = removalSheet?.closest('.sheet-backdrop');
    removalBackdrop?.addEventListener('click', (event) => { if (event.target === removalBackdrop) closeFriendRemovalSheet(); });
  }; });
  sheet.querySelector('[data-people-discovery-back]')?.addEventListener('click', () => {'''
assert old_bind in app
app = app.replace(old_bind, new_bind, 1)

APP.write_text(app)
