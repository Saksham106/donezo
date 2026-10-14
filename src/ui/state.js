// Shared UI state. Every module reads and writes `ui.*` so the split files
// behave like the single-file app did, without a framework.
import { parseNotificationDeepLink } from '../notifications.js';
import { parseInviteParam } from '../invite.js';
import { localDateInTimeZone } from '../domain.js';
import { isCheckedIn } from '../today-domain.js';

export const app = document.querySelector('#app');
export const inputs = {
  camera: document.querySelector('#proof-input'),
  gallery: document.querySelector('#proof-gallery-input'),
  dualMain: document.querySelector('#dual-proof-main-input'),
  selfie: document.querySelector('#proof-selfie-input'),
};

export const PRIMARY_TABS = ['home', 'friends', 'standings', 'profile'];
// Server-stored deep links and old localStorage values still use the pre-redesign tab names.
const LEGACY_TABS = { today: 'home', checkin: 'home', squad: 'friends', league: 'standings', me: 'profile' };
export const ACTIVE_TAB_KEY = 'donezo.activeTab';

export function normalizeTab(value) {
  const mapped = LEGACY_TABS[value] || value;
  return PRIMARY_TABS.includes(mapped) ? mapped : 'home';
}

function storedTab() {
  try { return localStorage.getItem(ACTIVE_TAB_KEY); } catch { return null; }
}

export const initialNavigation = parseNotificationDeepLink(window.location.href);
// The parser defaults a missing tab to 'today', so only trust it when the URL names one.
// Post links (`?checkIn=`) open Home, where the feed now lives.
const linkedTab = initialNavigation.checkInId
  ? 'home'
  : new URL(window.location.href).searchParams.has('tab') ? initialNavigation.tab : null;
const pendingInvite = parseInviteParam(window.location.href);

export const ui = {
  repo: null,
  session: null,
  tab: normalizeTab(linkedTab || storedTab() || 'home'),
  // Check In overlay: null | 'picker' | 'caught-up'. The proof flow uses proofHabit / proofReview.
  checkInOverlay: null,
  proofHabit: null,
  proofReview: null,
  proofPreparationId: 0,
  dualProof: null,
  dualRoleChoice: null,
  proofCrop: null,
  proofRejectCheckInId: null,
  postMenuCheckInId: null,
  reactionPickerCheckInId: null,
  checkInUndoRequest: null,
  selectedEmoji: '⚡',
  habitSheetOpen: false,
  editingHabitId: null,
  settingsSheetOpen: false,
  settingsView: 'menu',
  updatesOpen: Boolean(initialNavigation.nudgesOpen),
  nudgeComposerUserId: null,
  friendProfileUserId: null,
  friendConnections: null,
  friendConnectionsLoading: false,
  friendConnectionsRequestId: 0,
  recoveryHabitId: null,
  recoveryMissedDate: null,
  challengeSheetOpen: false,
  challengeInfoOpen: false,
  pastChallengesOpen: false,
  standingsWeek: 'this',
  feedLimit: 12,
  inviteSheetOpen: false,
  addFriendSheetOpen: false,
  requestsOpen: false,
  historyOpen: false,
  historyRange: 'week',
  peopleSheetOpen: false,
  peopleSearchQuery: '',
  peopleSearchResults: [],
  peopleSearchLoading: false,
  peopleSuggestions: [],
  peopleSuggestionsLoading: false,
  peopleSearchRequestId: 0,
  peopleSuggestionsRequestId: 0,
  peopleSearchDebounceTimer: null,
  discoveryProfilePerson: null,
  friendRemovalPerson: null,
  friendsQuery: '',
  friendsSearchResults: [],
  friendsSearchLoading: false,
  friendsSearchRequestId: 0,
  friendsSearchTimer: null,
  commentCheckInId: null,
  commentRetryDraft: null,
  batonSheetOpen: false,
  badgeCabinetOpen: false,
  wrappedOpen: false,
  wrappedIndex: 0,
  pendingInvite,
  inviteMessage: pendingInvite.present && !pendingInvite.valid
    ? 'That invite link looks busted. Paste a fresh invite code or dismiss it.'
    : '',
  createdFriendInvite: null,
  prefetchedFriendInvite: null,
  friendInvitePromise: null,
  friendInvitePreparing: false,
  refreshCoordinator: null,
  bootGeneration: 0,
  manualRefreshLoading: false,
  lastRefreshAt: null,
  online: navigator.onLine !== false,
  busy: false,
  authMode: 'sign-in',
  authMessage: '',
  initialNavigationHandled: false,
  pwaUpdateAvailable: Boolean(window.DonezoPWA?.updateAvailable),
  pwaApplying: false,
  mutationStatus: 'idle',
  retryMutation: null,
  networkBootLoading: false,
  authoritativeReady: false,
  reconciliationTimer: null,
};

export const optimisticPatches = new Map();
export const proofThumbnailUrls = new Map();
export const screenScroll = { home: 0, friends: 0, standings: 0, profile: 0 };

export function setActiveTab(nextTab) {
  ui.tab = normalizeTab(nextTab);
  try { localStorage.setItem(ACTIVE_TAB_KEY, ui.tab); } catch { /* Private mode: tab just is not remembered. */ }
}

export const getState = () => ui.repo?.peekState?.() || ui.repo?.getState();

export function friendList(state = getState()) {
  return Array.isArray(state?.friends) ? state.friends : (state?.members || []);
}

export function activityList(state = getState()) {
  return Array.isArray(state?.activities) ? state.activities : (state?.friendActivities || []);
}

export function leagueMembers(state = getState()) {
  const people = friendList(state);
  const current = people.find((person) => person.id === state?.currentUserId)
    || (state?.members || []).find((person) => person.id === state?.currentUserId)
    || state?.currentUser
    || state?.user;
  return current && !people.some((person) => person.id === current.id) ? [current, ...people] : people;
}

export function me() {
  const state = getState();
  return friendList(state).find((person) => person.id === state?.currentUserId)
    || state?.members?.find((person) => person.id === state?.currentUserId)
    || state?.currentUser
    || state?.user
    || { id: state?.currentUserId, name: 'You', avatar: '?' };
}

export const today = () => localDateInTimeZone(new Date(), me()?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

export const member = (id) => friendList(getState()).find((item) => item.id === id)
  || getState()?.members?.find((item) => item.id === id)
  || getState()?.peopleDirectory?.find((item) => item.id === id);

export const checkInFor = (habitId, userId = me()?.id, date = today()) => getState()?.checkIns.find((checkIn) => checkIn.habitId === habitId && checkIn.userId === userId && checkIn.date === date);

export const done = (habitId) => isCheckedIn(getState(), habitId, me()?.id, today());
