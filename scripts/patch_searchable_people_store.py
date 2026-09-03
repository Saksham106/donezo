from pathlib import Path

path = Path('src/store.js')
text = path.read_text()

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
"""function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function appError(error, fallback) {""",
"""function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function mapDiscoveryPerson(person = {}) {
  const name = person.display_name || person.name || person.username || 'Donezo user';
  const username = String(person.username || '').replace(/^@/, '');
  return {
    id: person.user_id || person.id,
    name,
    username,
    handle: username ? `@${username}` : '',
    avatar: person.avatar || initials(name),
    avatarUrl: person.avatar_url || person.avatarUrl || null,
    relationship: person.relationship_status || person.relationship || 'available',
    requestId: person.request_id || person.requestId || null,
    mutualCount: Number(person.mutual_count ?? person.mutualCount ?? 0),
  };
}

function normalizeDonezoUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
}

function appError(error, fallback) {""",
'map discovery helper')

replace_once(
"""  async function loadFriendConnections(targetFriendId) {
    if (!targetFriendId || targetFriendId === user.id) return [];
    const { data, error } = await client.rpc('list_friend_connections', { target_friend_id: targetFriendId });
    if (error) throw appError(error, 'Could not load this friend’s friends');
    return (data || []).map((person) => {
      const name = person.display_name || person.username || 'Donezo user';
      return {
        id: person.user_id,
        name,
        handle: person.username ? `@${person.username}` : '',
        avatar: initials(name),
        avatarUrl: person.avatar_url || null,
        relationship: person.relationship_status || 'available',
        requestId: person.request_id || null,
        mutualCount: Number(person.mutual_count || 0),
      };
    });
  }

  async function acceptFriendInvite(inviteCode) {""",
"""  async function loadFriendConnections(targetFriendId) {
    if (!targetFriendId || targetFriendId === user.id) return [];
    const { data, error } = await client.rpc('list_friend_connections', { target_friend_id: targetFriendId });
    if (error) throw appError(error, 'Could not load this friend’s friends');
    return (data || []).map(mapDiscoveryPerson);
  }

  async function searchPeople(query, limit = 20) {
    const { data, error } = await client.rpc('search_people', {
      search_query: String(query || ''),
      result_limit: Math.max(1, Math.min(20, Number(limit) || 20)),
    });
    if (error) throw appError(error, 'Could not search people');
    return (data || []).map(mapDiscoveryPerson);
  }

  async function suggestPeople(limit = 10) {
    const { data, error } = await client.rpc('suggest_people', {
      result_limit: Math.max(1, Math.min(20, Number(limit) || 10)),
    });
    if (error) throw appError(error, 'Could not load suggestions');
    return (data || []).map(mapDiscoveryPerson);
  }

  async function setMyUsername(username) {
    const { data, error } = await client.rpc('set_my_username', { desired_username: String(username || '') });
    if (error) throw appError(error, /taken/i.test(error.message || '') ? 'Username is taken' : 'Could not save username');
    const saved = String(data || '').replace(/^@/, '');
    const patch = (person) => person?.id === user.id ? { ...person, username: saved, handle: `@${saved}` } : person;
    state.members = (state.members || []).map(patch);
    state.friends = (state.friends || []).map(patch);
    state.personalizedLeague = (state.personalizedLeague || []).map(patch);
    state.peopleDirectory = (state.peopleDirectory || []).map(patch);
    return saved;
  }

  async function acceptFriendInvite(inviteCode) {""",
'production discovery methods')

replace_once(
"""    loadFriends,
    loadFriendConnections,
    createFriendInvite,""",
"""    loadFriends,
    loadFriendConnections,
    searchPeople,
    suggestPeople,
    setMyUsername,
    createFriendInvite,""",
'production return methods')

replace_once(
"""  function loadFriendConnections(targetFriendId) {
    const actor = state.currentUserId;
    if (!getFriendIds().includes(targetFriendId)) throw new Error('Direct friendship required');
    const candidateIds = directFriendIds(targetFriendId, state.friendships || []).filter((id) => id !== actor);
    const profiles = state.profiles || state.members || [];
    const actorFriendIds = new Set(getFriendIds());
    return candidateIds.map((candidateId) => {
      const profile = profiles.find((item) => item.id === candidateId) || { id: candidateId, name: 'Donezo user' };
      const pending = (state.friendRequests || []).find((request) => request.status === 'pending'
        && ((request.requesterId === actor && request.addresseeId === candidateId)
          || (request.requesterId === candidateId && request.addresseeId === actor)));
      const name = profile.name || profile.display_name || profile.username || 'Donezo user';
      return {
        id: candidateId,
        name,
        handle: profile.handle || (profile.username ? `@${profile.username}` : ''),
        avatar: profile.avatar || initials(name),
        avatarUrl: profile.avatarUrl || profile.avatar_url || null,
        relationship: actorFriendIds.has(candidateId) ? 'friend' : pending?.requesterId === actor ? 'outgoing' : pending ? 'incoming' : 'available',
        requestId: pending?.id || null,
        mutualCount: directFriendIds(candidateId, state.friendships || []).filter((id) => actorFriendIds.has(id)).length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function ensureFriendsWorkspace() {""",
"""  function memoryDiscoveryPerson(profile, actor = state.currentUserId) {
    const actorFriendIds = new Set(directFriendIds(actor, state.friendships || []));
    const candidateId = profile.id;
    const pending = (state.friendRequests || []).find((request) => request.status === 'pending'
      && (((request.requesterId || request.requester_id) === actor && (request.addresseeId || request.addressee_id) === candidateId)
        || ((request.requesterId || request.requester_id) === candidateId && (request.addresseeId || request.addressee_id) === actor)));
    const requesterId = pending?.requesterId || pending?.requester_id;
    const mutualCount = directFriendIds(candidateId, state.friendships || []).filter((id) => actorFriendIds.has(id)).length;
    return mapDiscoveryPerson({
      ...profile,
      user_id: candidateId,
      display_name: profile.display_name || profile.name,
      avatar_url: profile.avatar_url || profile.avatarUrl,
      relationship_status: actorFriendIds.has(candidateId) ? 'friend' : requesterId === actor ? 'outgoing' : pending ? 'incoming' : 'available',
      request_id: pending?.id || null,
      mutual_count: mutualCount,
    });
  }

  function loadFriendConnections(targetFriendId) {
    const actor = state.currentUserId;
    if (!getFriendIds().includes(targetFriendId)) throw new Error('Direct friendship required');
    const candidateIds = directFriendIds(targetFriendId, state.friendships || []).filter((id) => id !== actor);
    const profiles = state.profiles || state.members || [];
    return candidateIds
      .map((candidateId) => memoryDiscoveryPerson(profiles.find((item) => item.id === candidateId) || { id: candidateId, name: 'Donezo user' }, actor))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  function searchPeople(query, limit = 20) {
    const actor = state.currentUserId;
    const normalized = String(query || '').trim().replace(/^@/, '').toLowerCase();
    if (normalized.length < 2) return [];
    const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 20));
    const profiles = state.profiles || state.members || [];
    const rank = (person) => {
      const username = String(person.username || '').toLowerCase();
      const name = String(person.name || person.display_name || '').toLowerCase();
      if (username === normalized) return 0;
      if (username.startsWith(normalized)) return 1;
      if (name.startsWith(normalized)) return 2;
      return 3;
    };
    return profiles
      .filter((profile) => profile.id !== actor)
      .filter((profile) => {
        const username = String(profile.username || '').toLowerCase();
        const name = String(profile.name || profile.display_name || '').toLowerCase();
        return username === normalized || username.startsWith(normalized) || name.startsWith(normalized) || name.includes(normalized);
      })
      .map((profile) => memoryDiscoveryPerson(profile, actor))
      .sort((a, b) => rank(a) - rank(b) || b.mutualCount - a.mutualCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, boundedLimit);
  }

  function suggestPeople(limit = 10) {
    const actor = state.currentUserId;
    const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
    const profiles = state.profiles || state.members || [];
    return profiles
      .filter((profile) => profile.id !== actor)
      .map((profile) => memoryDiscoveryPerson(profile, actor))
      .filter((person) => person.relationship !== 'friend' && person.mutualCount > 0)
      .sort((a, b) => b.mutualCount - a.mutualCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, boundedLimit);
  }

  function setMyUsername(username) {
    const normalized = normalizeDonezoUsername(username);
    if (!/^[a-z0-9][a-z0-9._]{2,29}$/.test(normalized)) throw new Error('Username must be 3-30 characters using letters, numbers, dots, or underscores');
    if (['admin', 'administrator', 'donezo', 'support', 'system'].includes(normalized)) throw new Error('Username is reserved');
    const profiles = state.profiles || state.members || [];
    if (profiles.some((profile) => profile.id !== state.currentUserId && String(profile.username || '').toLowerCase() === normalized)) throw new Error('Username is taken');
    const patch = (profile) => profile.id === state.currentUserId ? { ...profile, username: normalized, handle: `@${normalized}` } : profile;
    if (state.profiles) state.profiles = state.profiles.map(patch);
    if (state.members) state.members = state.members.map(patch);
    if (state.peopleDirectory) state.peopleDirectory = state.peopleDirectory.map(patch);
    emit();
    return normalized;
  }

  function ensureFriendsWorkspace() {""",
'memory discovery methods')

replace_once(
"""    getState, asUser, ensureFriendsWorkspace, getFriends, getFriendIds, loadFriendConnections, createFriendInvite, acceptFriendInvite, inviteFriend, acceptFriend, removeFriend, addFriendForTest,
""",
"""    getState, asUser, ensureFriendsWorkspace, getFriends, getFriendIds, loadFriendConnections, searchPeople, suggestPeople, setMyUsername, createFriendInvite, acceptFriendInvite, inviteFriend, acceptFriend, removeFriend, addFriendForTest,
""",
'memory return methods')

path.write_text(text)
