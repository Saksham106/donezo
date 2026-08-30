export const AUDIENCES = Object.freeze({
  ALL_FRIENDS: 'all_friends',
  SELECTED_FRIENDS: 'selected_friends',
  ONLY_ME: 'only_me',
});

const AUDIENCE_VALUES = new Set(Object.values(AUDIENCES));

function userIdOf(value) {
  return value?.id ?? value?.userId ?? value?.user_id ?? value;
}

export function canonicalFriendPair(first, second) {
  const a = String(userIdOf(first) ?? '');
  const b = String(userIdOf(second) ?? '');
  if (!a || !b || a === b) throw new Error('A friendship needs two different users');
  return a < b ? [a, b] : [b, a];
}

function pairOf(friendship) {
  const first = friendship?.user_a ?? friendship?.userA ?? friendship?.userId;
  const second = friendship?.user_b ?? friendship?.userB ?? friendship?.friendId;
  if (first == null || second == null || String(first) === String(second)) return null;
  return canonicalFriendPair(first, second);
}

export function isDirectFriend(userId, otherUserId, friendships = []) {
  if (!userId || !otherUserId || String(userId) === String(otherUserId)) return false;
  const [a, b] = canonicalFriendPair(userId, otherUserId);
  return friendships.some((friendship) => {
    const pair = pairOf(friendship);
    return pair && pair[0] === a && pair[1] === b;
  });
}

export function directFriendIds(userId, friendships = []) {
  const result = new Set();
  for (const friendship of friendships) {
    const pair = pairOf(friendship);
    if (!pair) continue;
    if (pair[0] === String(userId)) result.add(pair[1]);
    if (pair[1] === String(userId)) result.add(pair[0]);
  }
  return [...result].sort();
}

export function normalizeAudience(audience, selectedFriendIds = [], ownerId = null, friendships = []) {
  const value = String(audience || AUDIENCES.ONLY_ME);
  if (!AUDIENCE_VALUES.has(value)) throw new Error(`Unsupported habit audience: ${value}`);
  const selected = [...new Set((Array.isArray(selectedFriendIds) ? selectedFriendIds : []).map(String))]
    .filter((id) => id && id !== String(ownerId));
  if (value === AUDIENCES.ALL_FRIENDS && selected.length) throw new Error('All-friends audience must not include selected friends');
  if (value === AUDIENCES.ONLY_ME && selected.length) throw new Error('Only-me audience must not include selected friends');
  if (value === AUDIENCES.SELECTED_FRIENDS && ownerId != null) {
    const allowed = new Set(directFriendIds(ownerId, friendships));
    if (selected.some((id) => !allowed.has(id))) throw new Error('Selected audience may contain direct friends only');
  }
  return value;
}

export function normalizedSelectedFriendIds(audience, selectedFriendIds = [], ownerId = null, friendships = []) {
  const value = normalizeAudience(audience, selectedFriendIds, ownerId, friendships);
  if (value !== AUDIENCES.SELECTED_FRIENDS) return [];
  return [...new Set(selectedFriendIds.map(String))].filter((id) => id && id !== String(ownerId)).sort();
}

export function snapshotAuthorizedViewers(habit = {}, friendships = []) {
  const ownerId = String(userIdOf(habit.ownerId ?? habit.owner_id) ?? '');
  if (!ownerId) throw new Error('Habit owner is required');
  const audience = String(habit.audience || habit.audience_type || AUDIENCES.ONLY_ME);
  const selected = habit.selectedFriendIds ?? habit.selected_friend_ids ?? [];
  const viewers = audience === AUDIENCES.ALL_FRIENDS
    ? directFriendIds(ownerId, friendships)
    : audience === AUDIENCES.SELECTED_FRIENDS
      ? normalizedSelectedFriendIds(audience, selected, ownerId, friendships)
      : [];
  return [...new Set([...viewers, ownerId])].sort();
}

export function canViewSnapshot(viewerId, authorizedViewerIds = []) {
  return Boolean(viewerId) && authorizedViewerIds.map(String).includes(String(viewerId));
}

export function personalizedLeagueMemberIds(currentUserId, friendships = [], profiles = []) {
  const allowed = new Set([String(currentUserId), ...directFriendIds(currentUserId, friendships)]);
  const known = profiles.length ? profiles.map(userIdOf).filter(Boolean).map(String) : [...allowed];
  return [...new Set(known.filter((id) => allowed.has(id)))].sort();
}

export function friendRequestInput(requesterId, addresseeId) {
  const [requester, addressee] = canonicalFriendPair(requesterId, addresseeId);
  return { requesterId: String(requesterId), addresseeId: String(addresseeId), pair: [requester, addressee] };
}
