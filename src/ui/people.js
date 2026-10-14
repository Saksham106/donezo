// Friends tab (A–Z contacts + search), friend requests, people discovery,
// friend profiles, invites, and removing a friend.
import { accountabilityDateForMember, dailyAccountabilitySummary, weeklyCompletionScore } from '../domain.js';
import { buildInviteLink, clearInviteParam, redeemInvite, validateInviteCode } from '../invite.js';
import { checkedInOn, friendRequestSummary, groupByInitial } from '../today-domain.js';
import { activityList, app, friendList, getState, me, member, today, ui } from './state.js';
import { avatar, esc, icon, notify, readableError } from './util.js';
import { render, renderPreservingScroll } from './render.js';
import { dataNotReady, scheduleStateCacheWrite } from './sync.js';
import { feedPost } from './home.js';

const normalizeQuery = (value) => String(value || '').trim().replace(/^@/, '').toLowerCase();

function friendsOnly(state = getState()) {
  return friendList(state).filter((person) => person.id !== state.currentUserId);
}

// --- Friends tab -----------------------------------------------------------

function friendRow(person, first) {
  const checkedIn = checkedInOn(getState(), person.id, today());
  return `<button type="button" class="dz-friend-row" data-friend-profile="${person.id}">${avatar(person, 36, { ring: checkedIn })}<span class="dz-friend-row-main ${first ? 'first' : ''}"><strong>${esc(person.name || 'Friend')}</strong><span class="dz-status ${checkedIn ? 'done' : ''}"><i aria-hidden="true"></i>${checkedIn ? 'Checked in' : 'Not yet'}</span></span></button>`;
}

function friendsListContent() {
  const query = normalizeQuery(ui.friendsQuery);
  const friends = friendsOnly().filter((person) => !query
    || String(person.name || '').toLowerCase().includes(query)
    || String(person.handle || person.username || '').toLowerCase().replace(/^@/, '').includes(query));
  const groups = groupByInitial(friends).map((group) => `<section class="dz-az-group"><h2>${esc(group.letter)}</h2><div class="dz-card-list">${group.people.map((person, index) => friendRow(person, index === 0)).join('')}</div></section>`).join('');
  const knownIds = new Set(friendsOnly().map((person) => person.id));
  const others = ui.friendsSearchResults.filter((person) => !knownIds.has(person.id) && person.id !== getState().currentUserId);
  const morePeople = query.length >= 2
    ? ui.friendsSearchLoading
      ? '<p class="dz-fine center">Searching more people…</p>'
      : others.length ? `<section class="dz-az-group"><h2>More people</h2><div class="dz-card-list">${others.map(peoplePersonRow).join('')}</div></section>` : ''
    : '';
  const empty = !friends.length && !morePeople
    ? query
      ? `<div class="dz-empty"><p>No friends match “${esc(ui.friendsQuery)}”.</p></div>`
      : '<div class="dz-empty"><h2>No friends yet</h2><p>Invite someone you want in your corner.</p><button type="button" class="dz-btn primary" data-invite-open>Share invite</button></div>'
    : '';
  return `${groups}${morePeople}${empty}`;
}

export function friendsScreen() {
  const { incoming, outgoing } = friendRequestSummary(getState());
  return `<header class="dz-header centered"><span></span><h1>Friends</h1><button type="button" class="dz-icon-btn" data-people-open aria-label="Add or invite friends">${icon('userPlus', 21)}</button></header><label class="dz-search">${icon('search', 17, 2)}<input type="search" name="friendsSearch" placeholder="Search" value="${esc(ui.friendsQuery)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label><button type="button" class="dz-requests-row" data-requests-open><span class="dz-round-icon coral">${icon('userPlus', 19)}</span><span class="dz-row-copy"><strong>Friend requests</strong><small>${incoming.length} received · ${outgoing.length} sent</small></span>${incoming.length ? `<span class="dz-badge">${incoming.length > 9 ? '9+' : incoming.length}</span>` : ''}${icon('chevron', 16, 2.2)}</button><div class="dz-friends-list" data-friends-list>${friendsListContent()}</div>`;
}

function patchFriendsList() {
  const list = app.querySelector('[data-friends-list]');
  if (!list) return;
  list.innerHTML = friendsListContent();
  bindPeopleRows(list);
}

function queueFriendsSearch(value) {
  ui.friendsQuery = String(value || '');
  clearTimeout(ui.friendsSearchTimer);
  const query = normalizeQuery(ui.friendsQuery);
  const requestId = ++ui.friendsSearchRequestId;
  if (query.length < 2) {
    ui.friendsSearchResults = [];
    ui.friendsSearchLoading = false;
    patchFriendsList();
    return;
  }
  ui.friendsSearchLoading = true;
  patchFriendsList();
  ui.friendsSearchTimer = setTimeout(async () => {
    try {
      const results = await ui.repo.searchPeople(query);
      if (requestId === ui.friendsSearchRequestId) ui.friendsSearchResults = results;
    } catch {
      if (requestId === ui.friendsSearchRequestId) ui.friendsSearchResults = [];
    } finally {
      if (requestId === ui.friendsSearchRequestId) {
        ui.friendsSearchLoading = false;
        patchFriendsList();
      }
    }
  }, 250);
}

// --- Friend requests ---------------------------------------------------------

export function requestsSheet() {
  if (!ui.requestsOpen) return '';
  const { incoming, outgoing } = friendRequestSummary(getState());
  const row = (request, direction) => {
    const userId = direction === 'incoming' ? request.requesterId : request.addresseeId;
    const person = member(userId) || { id: userId, name: 'Donezo user' };
    const action = direction === 'incoming'
      ? `<button class="dz-btn primary small" type="button" data-people-accept="${esc(request.id)}" data-people-user="${esc(userId)}">Accept</button>`
      : `<button class="dz-btn secondary small" type="button" data-people-cancel="${esc(request.id)}" data-people-user="${esc(userId)}">Cancel</button>`;
    return `<article class="dz-list-row">${avatar(person, 36)}<span class="dz-row-copy"><strong>${esc(person.name || 'Donezo user')}</strong>${person.handle ? `<small>${esc(person.handle)}</small>` : ''}</span>${action}</article>`;
  };
  const section = (title, list, direction) => `<section class="dz-sheet-section"><h3>${title} <span>${list.length}</span></h3>${list.length ? list.map((request) => row(request, direction)).join('') : '<p class="dz-fine">Nothing here.</p>'}</section>`;
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet dz-sheet tall" role="dialog" aria-modal="true" aria-label="Friend requests" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Friend requests</h2></div><button class="icon-btn" type="button" data-close-requests aria-label="Close">×</button></div>${section('Received', incoming, 'incoming')}${section('Sent', outgoing, 'outgoing')}</section></div>`;
}

// --- People discovery sheet -------------------------------------------------

function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return `<button class="dz-btn secondary small" type="button" data-people-remove="${esc(person.id)}">Friends</button>`;
  if (person.relationship === 'outgoing') return `<button class="dz-btn secondary small" type="button" data-people-cancel="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Requested</button>`;
  if (person.relationship === 'incoming') return `<button class="dz-btn primary small" type="button" data-people-accept="${esc(person.requestId)}" data-people-user="${esc(person.id)}">Accept</button>`;
  return `<button class="dz-btn primary small" type="button" data-people-add="${esc(person.id)}">Add</button>`;
}

function peoplePersonRow(person) {
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  const detail = [handle, mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : ''].filter(Boolean).join(' · ');
  return `<article class="dz-list-row"><button class="dz-list-identity" type="button" data-people-person="${esc(person.id)}">${avatar(person, 36)}<span class="dz-row-copy"><strong>${esc(person.name || 'Donezo user')}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span></button>${peopleRelationshipAction(person)}</article>`;
}

function discoveryProfileSheet() {
  const person = ui.discoveryProfilePerson;
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet dz-sheet people-sheet" role="dialog" aria-modal="true" aria-label="${esc(person.name || 'Donezo user')} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><button class="settings-back" type="button" data-people-discovery-back>‹ People</button></div><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div><div class="dz-profile-card">${avatar(person, 72)}<strong>${esc(person.name || 'Donezo user')}</strong>${handle ? `<span>${esc(handle)}</span>` : ''}<small>${mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : 'No mutual friends yet'}</small>${peopleRelationshipAction(person)}</div></section></div>`;
}

export function peopleSheet() {
  if (!ui.peopleSheetOpen || ui.friendProfileUserId || ui.inviteSheetOpen) return '';
  if (ui.discoveryProfilePerson) return discoveryProfileSheet();
  const searching = normalizeQuery(ui.peopleSearchQuery).length >= 2;
  const suggestions = ui.peopleSuggestionsLoading
    ? '<section class="dz-sheet-section"><h3>Suggested for you</h3><p class="dz-fine">Finding people you may know…</p></section>'
    : ui.peopleSuggestions.length ? `<section class="dz-sheet-section"><h3>Suggested for you</h3>${ui.peopleSuggestions.map(peoplePersonRow).join('')}</section>` : '';
  const defaultContent = `<div class="dz-invite-actions"><button class="dz-btn primary full" type="button" data-invite-from-people ${ui.friendInvitePreparing ? 'disabled aria-busy="true"' : ''}>${icon('share', 18, 2)} ${ui.friendInvitePreparing ? 'Preparing…' : 'Share invite link'}</button><button class="dz-btn secondary full" type="button" data-add-friend-from-people>Have an invite code?</button></div>${suggestions}`;
  const searchContent = ui.peopleSearchLoading
    ? '<p class="dz-fine center">Searching…</p>'
    : ui.peopleSearchResults.length ? ui.peopleSearchResults.map(peoplePersonRow).join('') : '<div class="dz-empty"><p>No people found. Try their @username or display name.</p></div>';
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet dz-sheet tall people-sheet" role="dialog" aria-modal="true" aria-label="Add friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Add friends</h2></div><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div><label class="dz-search in-sheet">${icon('search', 17, 2)}<input name="peopleSearch" type="search" placeholder="Search by name or @username" value="${esc(ui.peopleSearchQuery)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label><div class="dz-people-body">${searching ? searchContent : defaultContent}</div></section></div>`;
}

export function closePeopleSheet() {
  ui.peopleSheetOpen = false;
  ui.peopleSearchQuery = '';
  ui.peopleSearchResults = [];
  ui.peopleSearchLoading = false;
  ui.peopleSuggestions = [];
  ui.peopleSuggestionsLoading = false;
  ui.discoveryProfilePerson = null;
  clearTimeout(ui.peopleSearchDebounceTimer);
  ui.peopleSearchDebounceTimer = null;
  ui.peopleSearchRequestId += 1;
  ui.peopleSuggestionsRequestId += 1;
}

/** Re-render only the people sheet so the search box keeps focus and caret. */
function refreshPeopleSheet() {
  if (!ui.peopleSheetOpen) return;
  const current = app.querySelector('.people-sheet')?.closest('.sheet-backdrop');
  if (!current) return;
  const input = current.querySelector('[name="peopleSearch"]');
  const focused = document.activeElement === input;
  const start = input?.selectionStart ?? null;
  const end = input?.selectionEnd ?? null;
  const container = document.createElement('div');
  container.innerHTML = peopleSheet();
  const next = container.firstElementChild;
  if (!next) { current.remove(); return; }
  current.replaceWith(next);
  bindPeopleSheet(next);
  if (!focused) return;
  const nextInput = next.querySelector('[name="peopleSearch"]');
  nextInput?.focus({ preventScroll: true });
  if (start !== null && end !== null) nextInput?.setSelectionRange?.(start, end);
}

function refreshPeopleViews() {
  refreshPeopleSheet();
  patchFriendsList();
  const requests = app.querySelector('[aria-label="Friend requests"]');
  if (requests) renderPreservingScroll();
}

function syncPeopleRelationship(userId, relationship, requestId) {
  const hasRequestId = arguments.length >= 3;
  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: hasRequestId ? requestId : (person.requestId ?? null) } : person;
  ui.peopleSearchResults = ui.peopleSearchResults.map(patch);
  ui.peopleSuggestions = ui.peopleSuggestions.map(patch);
  ui.friendsSearchResults = ui.friendsSearchResults.map(patch);
  if (ui.discoveryProfilePerson?.id === userId) ui.discoveryProfilePerson = patch(ui.discoveryProfilePerson);
}

function snapshotPeople() {
  return {
    search: ui.peopleSearchResults,
    suggestions: ui.peopleSuggestions,
    friendsSearch: ui.friendsSearchResults,
    discovery: ui.discoveryProfilePerson,
  };
}

function restorePeople(snapshot) {
  ui.peopleSearchResults = snapshot.search;
  ui.peopleSuggestions = snapshot.suggestions;
  ui.friendsSearchResults = snapshot.friendsSearch;
  ui.discoveryProfilePerson = snapshot.discovery;
}

async function handlePeopleAdd(userId) {
  if (!userId || dataNotReady()) return;
  const snapshot = snapshotPeople();
  syncPeopleRelationship(userId, 'outgoing');
  refreshPeopleViews();
  try {
    const request = await ui.repo.inviteFriend(userId);
    syncPeopleRelationship(userId, 'outgoing', request?.id || null);
    scheduleStateCacheWrite();
    notify('Friend request sent.');
  } catch (error) {
    restorePeople(snapshot);
    notify(readableError(error), 3600);
  }
  refreshPeopleViews();
  if (ui.friendProfileUserId) await reloadOpenFriendConnections();
}

async function handlePeopleCancel(requestId, userId) {
  if (!requestId || !userId || dataNotReady()) return;
  const snapshot = snapshotPeople();
  syncPeopleRelationship(userId, 'available', null);
  refreshPeopleViews();
  try {
    await ui.repo.cancelFriendRequest(requestId);
    scheduleStateCacheWrite();
    notify('Friend request unsent.');
  } catch (error) {
    restorePeople(snapshot);
    notify(readableError(error), 3600);
  }
  refreshPeopleViews();
}

async function handlePeopleAccept(requestId, userId) {
  if (!requestId || dataNotReady()) return;
  const snapshot = snapshotPeople();
  if (userId) syncPeopleRelationship(userId, 'friend', null);
  refreshPeopleViews();
  try {
    await ui.repo.acceptFriend(requestId);
    scheduleStateCacheWrite();
    notify('Friend added.');
  } catch (error) {
    restorePeople(snapshot);
    notify(readableError(error), 3600);
  }
  renderPreservingScroll();
  if (ui.friendProfileUserId) await reloadOpenFriendConnections();
}

function queuePeopleSearch(rawQuery) {
  ui.peopleSearchQuery = String(rawQuery || '');
  clearTimeout(ui.peopleSearchDebounceTimer);
  const normalized = normalizeQuery(ui.peopleSearchQuery);
  const requestId = ++ui.peopleSearchRequestId;
  if (normalized.length < 2) {
    ui.peopleSearchResults = [];
    ui.peopleSearchLoading = false;
    refreshPeopleSheet();
    return;
  }
  ui.peopleSearchLoading = true;
  refreshPeopleSheet();
  ui.peopleSearchDebounceTimer = setTimeout(async () => {
    try {
      const results = await ui.repo.searchPeople(normalized);
      if (requestId !== ui.peopleSearchRequestId || !ui.peopleSheetOpen) return;
      ui.peopleSearchResults = results;
    } catch (error) {
      if (requestId === ui.peopleSearchRequestId) notify(readableError(error), 3600);
    } finally {
      if (requestId === ui.peopleSearchRequestId && ui.peopleSheetOpen) {
        ui.peopleSearchLoading = false;
        refreshPeopleSheet();
      }
    }
  }, 250);
}

async function loadPeopleSuggestions() {
  const requestId = ++ui.peopleSuggestionsRequestId;
  ui.peopleSuggestionsLoading = true;
  refreshPeopleSheet();
  try {
    const suggestions = await ui.repo.suggestPeople(10);
    if (requestId !== ui.peopleSuggestionsRequestId || !ui.peopleSheetOpen) return;
    ui.peopleSuggestions = suggestions;
  } catch (error) {
    if (requestId !== ui.peopleSuggestionsRequestId) return;
    ui.peopleSuggestions = [];
    notify(readableError(error), 3600);
  } finally {
    if (requestId === ui.peopleSuggestionsRequestId && ui.peopleSheetOpen) {
      ui.peopleSuggestionsLoading = false;
      refreshPeopleSheet();
    }
  }
}

export function openPeopleSheet() {
  closePeopleSheet();
  ui.peopleSheetOpen = true;
  render();
  void primeFriendInvite();
  void loadPeopleSuggestions();
}

function findPerson(userId) {
  const rawFriend = friendList(getState()).find((item) => item.id === userId);
  return [...ui.peopleSearchResults, ...ui.peopleSuggestions, ...ui.friendsSearchResults].find((item) => item.id === userId)
    || (rawFriend ? { ...rawFriend, relationship: 'friend' } : null);
}

function openPeoplePerson(person) {
  if (!person?.id) return;
  if (person.relationship === 'friend' || friendList(getState()).some((friend) => friend.id === person.id)) {
    ui.discoveryProfilePerson = null;
    void openFriendProfile(person.id);
    return;
  }
  ui.discoveryProfilePerson = { ...person };
  if (ui.peopleSheetOpen) refreshPeopleSheet();
  else { ui.peopleSheetOpen = true; render(); }
}

// --- Friend removal ------------------------------------------------------------

export function friendRemovalSheet() {
  if (!ui.friendRemovalPerson) return '';
  return `<div class="sheet-backdrop friend-removal-layer"><section class="sheet compact-sheet friend-removal-sheet" role="alertdialog" aria-modal="true" aria-label="Remove friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><p class="eyebrow">FRIENDS</p><h2>Remove friend?</h2></div><button class="icon-btn" type="button" data-cancel-friend-removal aria-label="Keep friend">×</button></div><p class="sheet-copy">${esc(ui.friendRemovalPerson.name || 'This friend')} will stop seeing future friend-only proofs. Proofs they could already see stay unchanged.</p><div class="confirm-actions"><button class="btn" type="button" data-cancel-friend-removal>Keep friend</button><button class="btn danger-soft" type="button" data-confirm-friend-removal>Remove friend</button></div></section></div>`;
}

async function handleRemoveFriend() {
  const person = ui.friendRemovalPerson;
  if (!person?.id || dataNotReady()) return;
  const snapshot = snapshotPeople();
  syncPeopleRelationship(person.id, 'available', null);
  ui.friendRemovalPerson = null;
  try {
    await ui.repo.removeFriend(person.id);
    if (ui.friendProfileUserId === person.id) closeFriendProfile();
    scheduleStateCacheWrite();
    notify(`${person.name || 'Friend'} removed.`);
  } catch (error) {
    restorePeople(snapshot);
    notify(readableError(error), 3600);
  }
  render();
}

// --- Friend profile -------------------------------------------------------------

export async function openFriendProfile(userId) {
  if (!userId) return;
  ui.commentCheckInId = null;
  ui.updatesOpen = false;
  ui.postMenuCheckInId = null;
  ui.requestsOpen = false;
  closePeopleSheet();
  ui.friendProfileUserId = userId;
  ui.friendConnections = null;
  ui.friendConnectionsLoading = userId !== getState()?.currentUserId && typeof ui.repo?.loadFriendConnections === 'function';
  const requestId = ++ui.friendConnectionsRequestId;
  render();
  if (!ui.friendConnectionsLoading) return;
  try {
    const connections = await ui.repo.loadFriendConnections(userId);
    if (requestId !== ui.friendConnectionsRequestId || ui.friendProfileUserId !== userId) return;
    ui.friendConnections = connections;
  } catch (error) {
    if (requestId !== ui.friendConnectionsRequestId) return;
    ui.friendConnections = [];
    notify(readableError(error), 3600);
  } finally {
    if (requestId === ui.friendConnectionsRequestId && ui.friendProfileUserId === userId) {
      ui.friendConnectionsLoading = false;
      renderPreservingScroll();
    }
  }
}

async function reloadOpenFriendConnections() {
  const userId = ui.friendProfileUserId;
  if (!userId || userId === getState()?.currentUserId || typeof ui.repo?.loadFriendConnections !== 'function') return;
  const requestId = ++ui.friendConnectionsRequestId;
  ui.friendConnectionsLoading = true;
  renderPreservingScroll();
  try {
    const connections = await ui.repo.loadFriendConnections(userId);
    if (requestId === ui.friendConnectionsRequestId && ui.friendProfileUserId === userId) ui.friendConnections = connections;
  } catch (error) {
    if (requestId === ui.friendConnectionsRequestId) notify(readableError(error), 3600);
  } finally {
    if (requestId === ui.friendConnectionsRequestId && ui.friendProfileUserId === userId) {
      ui.friendConnectionsLoading = false;
      renderPreservingScroll();
    }
  }
}

export function closeFriendProfile() {
  ui.friendProfileUserId = null;
  ui.friendConnectionsRequestId += 1;
  ui.friendConnections = null;
  ui.friendConnectionsLoading = false;
}

export function friendProfileSheet() {
  if (!ui.friendProfileUserId) return '';
  const person = ui.friendProfileUserId === getState().currentUserId ? me() : member(ui.friendProfileUserId);
  if (!person) return '';
  const state = getState();
  const isMe = person.id === state.currentUserId;
  const habits = state.habits.filter((habit) => habit.ownerId === person.id && habit.active);
  const recent = activityList(state).filter((item) => item.userId === person.id && !['missed', 'callout'].includes(item.type));
  const score = weeklyCompletionScore(person.id, state.habits, state.checkIns, today());
  const daily = dailyAccountabilitySummary(person.id, state.habits, state.checkIns, accountabilityDateForMember(person));
  const todayLine = daily.today.remaining.length
    ? `${daily.today.remaining.length} left: ${daily.today.remaining.map((habit) => `${habit.emoji || '○'} ${habit.title}`).join(', ')}`
    : daily.today.total ? 'All clear.' : 'No habits due.';
  const yesterdayLine = daily.yesterday.missed.length
    ? `Missed: ${daily.yesterday.missed.map((habit) => `${habit.emoji || '○'} ${habit.title}`).join(', ')}`
    : daily.yesterday.total ? 'Clean day.' : 'No habits were due.';
  const connectionRows = (ui.friendConnections || []).map((connection) => {
    const relationship = connection.relationship === 'available' ? 'available' : connection.relationship;
    return peoplePersonRow({ ...connection, relationship });
  }).join('');
  const connectionCount = (ui.friendConnections || []).length + 1;
  const connections = isMe ? '' : `<details class="dz-details"><summary><span><strong>${ui.friendConnectionsLoading ? 'Friends' : `${connectionCount} ${connectionCount === 1 ? 'friend' : 'friends'}`}</strong><small>${ui.friendConnectionsLoading ? 'Loading…' : 'Mutuals and people to add'}</small></span>${icon('chevron', 16, 2.2)}</summary><div>${ui.friendConnectionsLoading ? '<p class="dz-fine">Loading friends…</p>' : connectionRows || '<p class="dz-fine">No other friends to show yet.</p>'}</div></details>`;
  const actions = isMe ? '' : `<div class="dz-profile-actions"><button class="dz-btn primary full" type="button" data-nudge="${person.id}">${icon('bolt', 18, 2)} Send a nudge</button><button class="dz-link danger" type="button" data-people-remove="${person.id}">Remove friend</button></div>`;
  return `<div class="sheet-backdrop" data-close-friend-profile-backdrop><section class="sheet dz-sheet tall friend-profile-sheet" role="dialog" aria-modal="true" aria-label="${esc(person.name)} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div></div><button class="icon-btn" type="button" data-close-friend-profile aria-label="Close profile">×</button></div><div class="dz-profile-card">${avatar(person, 72, { ring: checkedInOn(state, person.id, today()) })}<strong>${esc(person.name)}</strong>${person.handle ? `<span>${esc(person.handle)}</span>` : ''}<small>${score.percent}% this week · ${icon('bolt', 13, 2.2)} ${person.currentStreak || 0}-day streak</small></div>${actions}<div class="dz-daily"><article><strong>Today · ${daily.today.completed}/${daily.today.total}</strong><p>${esc(todayLine)}</p></article><article class="${daily.yesterday.missed.length ? 'missed' : ''}"><strong>Yesterday · ${daily.yesterday.completed}/${daily.yesterday.total}</strong><p>${esc(yesterdayLine)}</p></article></div>${connections}<section class="dz-sheet-section"><h3>Habits</h3>${habits.length ? `<div class="dz-chip-wrap">${habits.map((habit) => `<span class="dz-pill neutral">${esc(habit.emoji)} ${esc(habit.title)}</span>`).join('')}</div>` : '<p class="dz-fine">No shared habits right now.</p>'}</section><section class="dz-sheet-section"><h3>Recent check-ins</h3><div class="dz-feed compact">${recent.length ? recent.slice(0, 10).map(feedPost).join('') : '<p class="dz-fine">No check-ins yet.</p>'}</div></section></section></div>`;
}

// --- Invites ---------------------------------------------------------------------

export function openInviteSheet() {
  ui.inviteSheetOpen = true;
  render();
  void primeFriendInvite();
}

export function inviteSheet() {
  if (!ui.inviteSheetOpen) return '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet invite-sheet" role="dialog" aria-modal="true" aria-label="Invite friends" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>Invite a friend</h2></div><button class="icon-btn" type="button" data-close-invite aria-label="Close">×</button></div><p class="sheet-copy">Share a fresh private link. They choose whether to connect.</p><button class="dz-btn primary full" type="button" data-share-invite ${ui.friendInvitePreparing ? 'disabled aria-busy="true"' : ''}>${icon('share', 18, 2)} ${ui.friendInvitePreparing ? 'Preparing…' : 'Share invite'}</button></section></div>`;
}

export function addFriendSheet() {
  if (!ui.addFriendSheetOpen) return '';
  const value = ui.pendingInvite.present ? (ui.pendingInvite.valid ? ui.pendingInvite.code : ui.pendingInvite.raw || '') : '';
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet compact-sheet dz-sheet add-friend-sheet" role="dialog" aria-modal="true" aria-label="Add a friend" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><h2>${ui.pendingInvite.present ? 'Accept invite' : 'Add with a code'}</h2></div><button class="icon-btn" type="button" data-close-add-friend aria-label="Close">×</button></div><p class="sheet-copy">${ui.pendingInvite.present ? 'A friend sent you an invite. Confirm it to connect.' : 'A full Donezo invite link or the raw invite code both work.'}</p>${ui.inviteMessage ? `<div class="form-message" role="alert">${esc(ui.inviteMessage)}</div>` : ''}<form id="join-friend-form" class="form sheet-form"><label>Invite link or code<input name="code" inputmode="text" autocomplete="one-time-code" autocapitalize="none" placeholder="Paste invite link or code" value="${esc(value)}" required></label><button class="dz-btn primary full" type="submit">${ui.pendingInvite.present ? 'Connect' : 'Add friend'}</button>${ui.pendingInvite.present ? '<button class="dz-link" type="button" data-dismiss-invite>Not my invite</button>' : ''}</form></section></div>`;
}

export function primeFriendInvite() {
  if (typeof ui.repo?.createFriendInvite !== 'function' || !ui.session || !ui.online || ui.networkBootLoading || !ui.authoritativeReady) return Promise.resolve(null);
  if (ui.prefetchedFriendInvite) return Promise.resolve(ui.prefetchedFriendInvite);
  if (ui.friendInvitePromise) return ui.friendInvitePromise;
  ui.friendInvitePreparing = true;
  ui.friendInvitePromise = ui.repo.createFriendInvite()
    .then((invite) => { ui.prefetchedFriendInvite = invite; return invite; })
    .catch((error) => { notify(readableError(error), 3600); return null; })
    .finally(() => {
      ui.friendInvitePreparing = false;
      ui.friendInvitePromise = null;
      if (ui.peopleSheetOpen) refreshPeopleSheet();
      else if (ui.inviteSheetOpen) renderPreservingScroll();
    });
  return ui.friendInvitePromise;
}

const inviteCodeFrom = (value) => (typeof value === 'string' ? value : value?.code || value?.inviteCode || '');

async function sharePreparedInvite(invite) {
  const code = inviteCodeFrom(invite);
  if (!validateInviteCode(code).valid) {
    notify('Invite code is not ready yet. Try again in a sec.', 3200);
    return false;
  }
  const url = (typeof invite === 'object' && invite?.url) || buildInviteLink(window.location.href, code);
  const consume = () => {
    if (invite !== ui.prefetchedFriendInvite) return;
    ui.prefetchedFriendInvite = null;
    if (ui.peopleSheetOpen || ui.inviteSheetOpen) void primeFriendInvite();
  };
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Join me on Donezo', text: 'Join me on Donezo. We’re trying to actually lock in.', url });
      consume();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify('Invite link copied');
    consume();
    return true;
  } catch {
    notify(url, 6000);
    return false;
  }
}

export async function handleShareInvite() {
  if (typeof ui.repo?.createFriendInvite !== 'function') {
    notify('Invites are unavailable right now.', 3200);
    return;
  }
  const invite = ui.prefetchedFriendInvite || ui.createdFriendInvite;
  if (!invite) {
    if (!dataNotReady()) {
      notify('Preparing a fresh invite…', 1800);
      void primeFriendInvite();
    }
    return;
  }
  await sharePreparedInvite(invite);
}

export function clearPendingInvite() {
  ui.pendingInvite = { present: false, valid: false, code: null, raw: null };
  ui.inviteMessage = '';
  history.replaceState({}, '', clearInviteParam(window.location.href));
}

export async function handleJoinFriend(event) {
  event.preventDefault();
  if (ui.session && dataNotReady()) return;
  if (ui.busy) return;
  const validation = validateInviteCode(String(new FormData(event.currentTarget).get('code')));
  if (!validation.valid) {
    ui.inviteMessage = 'That invite code does not look right. Paste a fresh one or dismiss this invite.';
    render();
    return;
  }
  ui.busy = true;
  ui.inviteMessage = '';
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = 'Connecting…'; }
  try {
    await redeemInvite(ui.repo, validation.code);
    ui.addFriendSheetOpen = false;
    clearPendingInvite();
    notify('You’re connected. Time to lock in.');
  } catch (error) {
    const message = readableError(error);
    ui.inviteMessage = /invalid|expired/i.test(message)
      ? 'That invite is invalid or expired. Ask your friend for a fresh link, or enter a different code.'
      : `Couldn’t connect with that friend. ${message}`;
    notify(ui.inviteMessage, 3600);
  } finally {
    ui.busy = false;
    render();
  }
}

// --- Binding ---------------------------------------------------------------------

function bindPeopleRows(root) {
  root.querySelectorAll('[data-friend-profile]').forEach((element) => { element.onclick = () => openFriendProfile(element.dataset.friendProfile); });
  root.querySelectorAll('[data-people-add]').forEach((element) => { element.onclick = () => handlePeopleAdd(element.dataset.peopleAdd); });
  root.querySelectorAll('[data-people-cancel]').forEach((element) => { element.onclick = () => handlePeopleCancel(element.dataset.peopleCancel, element.dataset.peopleUser); });
  root.querySelectorAll('[data-people-accept]').forEach((element) => { element.onclick = () => handlePeopleAccept(element.dataset.peopleAccept, element.dataset.peopleUser); });
  root.querySelectorAll('[data-people-person]').forEach((element) => { element.onclick = () => openPeoplePerson(findPerson(element.dataset.peoplePerson)); });
  root.querySelectorAll('[data-people-remove]').forEach((element) => { element.onclick = () => {
    const person = findPerson(element.dataset.peopleRemove) || member(element.dataset.peopleRemove);
    if (!person) return;
    ui.friendRemovalPerson = { ...person };
    renderPreservingScroll();
  }; });
  root.querySelectorAll('[data-invite-open]').forEach((element) => { element.onclick = openInviteSheet; });
}

function bindPeopleSheet(root) {
  bindPeopleRows(root);
  root.addEventListener('click', (event) => { if (event.target === root && root.hasAttribute('data-close-people-backdrop')) { closePeopleSheet(); render(); } });
  root.querySelectorAll('[data-close-people]').forEach((element) => { element.onclick = () => { closePeopleSheet(); render(); }; });
  root.querySelectorAll('[data-invite-from-people]').forEach((element) => { element.onclick = handleShareInvite; });
  root.querySelectorAll('[data-add-friend-from-people]').forEach((element) => { element.onclick = () => {
    closePeopleSheet();
    ui.inviteMessage = '';
    ui.addFriendSheetOpen = true;
    render();
  }; });
  root.querySelector('[name="peopleSearch"]')?.addEventListener('input', (event) => queuePeopleSearch(event.target.value));
  root.querySelectorAll('[data-people-discovery-back]').forEach((element) => { element.onclick = () => { ui.discoveryProfilePerson = null; refreshPeopleSheet(); }; });
}

export function bindPeople(root) {
  bindPeopleRows(root);
  root.querySelectorAll('[data-people-open]').forEach((element) => { element.onclick = openPeopleSheet; });
  root.querySelectorAll('[data-requests-open]').forEach((element) => { element.onclick = () => { ui.requestsOpen = true; render(); }; });
  root.querySelectorAll('[data-close-requests]').forEach((element) => { element.onclick = () => { ui.requestsOpen = false; render(); }; });
  root.querySelector('[name="friendsSearch"]')?.addEventListener('input', (event) => queueFriendsSearch(event.target.value));
  const peopleRoot = root.querySelector('.people-sheet')?.closest('.sheet-backdrop');
  if (peopleRoot) bindPeopleSheet(peopleRoot);
  root.querySelectorAll('[data-close-friend-profile], [data-close-friend-profile-backdrop]').forEach((element) => { element.onclick = (event) => {
    if (element.hasAttribute('data-close-friend-profile-backdrop') && event.target !== element) return;
    closeFriendProfile();
    render();
  }; });
  root.querySelectorAll('[data-cancel-friend-removal]').forEach((element) => { element.onclick = () => { ui.friendRemovalPerson = null; render(); }; });
  root.querySelector('[data-confirm-friend-removal]')?.addEventListener('click', () => { void handleRemoveFriend(); });
  root.querySelectorAll('[data-share-invite]').forEach((element) => { element.onclick = handleShareInvite; });
  root.querySelectorAll('[data-close-invite]').forEach((element) => { element.onclick = () => { ui.inviteSheetOpen = false; render(); }; });
  root.querySelectorAll('[data-close-add-friend]').forEach((element) => { element.onclick = () => { ui.addFriendSheetOpen = false; render(); }; });
  root.querySelector('#join-friend-form')?.addEventListener('submit', handleJoinFriend);
  root.querySelectorAll('[data-dismiss-invite]').forEach((element) => { element.onclick = () => { clearPendingInvite(); ui.addFriendSheetOpen = false; render(); }; });
}

/** Opens the add-friend sheet when the app was launched from an invite link. */
export function offerPendingInvite() {
  if (!ui.pendingInvite.present || ui.addFriendSheetOpen) return;
  ui.addFriendSheetOpen = true;
  render();
}
