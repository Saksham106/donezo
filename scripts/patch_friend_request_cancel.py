from pathlib import Path

STORE = Path('src/store.js')
store = STORE.read_text()

production_anchor = '''  async function acceptFriend(requestId) {
    if (!requestId) throw new Error('Friend request is required');
'''
production_method = '''  async function cancelFriendRequest(requestId) {
    if (!requestId) throw new Error('Friend request is required');
    const { data, error } = await client.rpc('cancel_friend_request', { target_request_id: requestId });
    if (error) throw appError(error, 'Could not cancel friend request');
    const respondedAt = data?.responded_at || data?.respondedAt || new Date().toISOString();
    state.friendRequests = (state.friendRequests || []).map((request) => request.id === requestId
      ? { ...request, status: 'cancelled', respondedAt }
      : request);
    return state.friendRequests.find((request) => request.id === requestId) || {
      id: requestId,
      status: 'cancelled',
      respondedAt,
    };
  }

'''
assert production_anchor in store
assert 'async function cancelFriendRequest(' not in store
store = store.replace(production_anchor, production_method + production_anchor, 1)

production_return = '''    inviteFriend,
    sendFriendInvite: inviteFriend,
    acceptFriend,
    removeFriend,
'''
production_return_new = '''    inviteFriend,
    sendFriendInvite: inviteFriend,
    cancelFriendRequest,
    acceptFriend,
    removeFriend,
'''
assert production_return in store
store = store.replace(production_return, production_return_new, 1)

memory_anchor = '''  function createFriendInvite() {
'''
memory_method = '''  function cancelFriendRequest(requestId) {
    const request = (state.friendRequests || []).find((item) => item.id === requestId
      && item.requesterId === state.currentUserId
      && item.status === 'pending');
    if (!request) throw new Error('Friend request is not open');
    request.status = 'cancelled';
    request.respondedAt = new Date().toISOString();
    emit();
    return clone(request);
  }

'''
assert memory_anchor in store
assert 'function cancelFriendRequest(' not in store
store = store.replace(memory_anchor, memory_method + memory_anchor, 1)

memory_return = '''    getState, asUser, ensureFriendsWorkspace, getFriends, getFriendIds, loadFriendConnections, searchPeople, suggestPeople, setMyUsername, createFriendInvite, acceptFriendInvite, inviteFriend, acceptFriend, removeFriend, addFriendForTest,
'''
memory_return_new = '''    getState, asUser, ensureFriendsWorkspace, getFriends, getFriendIds, loadFriendConnections, searchPeople, suggestPeople, setMyUsername, createFriendInvite, acceptFriendInvite, inviteFriend, cancelFriendRequest, acceptFriend, removeFriend, addFriendForTest,
'''
assert memory_return in store
store = store.replace(memory_return, memory_return_new, 1)

STORE.write_text(store)
