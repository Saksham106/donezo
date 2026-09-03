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
    "let peopleSearchDebounceTimer = null;\nconst proofThumbnailUrls = new Map();",
    "let peopleSearchDebounceTimer = null;\nlet discoveryProfilePerson = null;\nconst proofThumbnailUrls = new Map();",
    'discovery profile state',
)

old_profile_view = '''    profile: `<form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="btn full">Save name</button></form><div class="install-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Push works best from the installed app.</p></div><button class="text-btn danger" id="sign-out">Sign out</button>`,'''
new_profile_view = '''    profile: `<form id="display-name-form" class="form sheet-form"><label>Display name<input name="displayName" maxlength="60" value="${esc(me().name)}" required></label><button class="btn full">Save name</button></form><form id="username-form" class="form sheet-form username-form"><label>Username<div class="username-input-wrap"><span aria-hidden="true">@</span><input name="username" value="${esc(String(me().handle || '').replace(/^@/, ''))}" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._]{2,29}" autocapitalize="none" autocomplete="off" spellcheck="false" required></div><small>People can find you by this.</small></label><button class="btn full">Save username</button></form><div class="install-card"><strong>Install Donezo</strong><p>iPhone: Safari → Share → Add to Home Screen. Push works best from the installed app.</p></div><button class="text-btn danger" id="sign-out">Sign out</button>`,'''
replace_once(old_profile_view, new_profile_view, 'username settings form')

insert = r'''
function discoveryProfileSheet() {
  if (!discoveryProfilePerson) return '';
  const person = discoveryProfilePerson;
  const handle = person.handle || (person.username ? `@${person.username}` : '');
  const mutual = Number(person.mutualCount || 0);
  const mutualCopy = mutual ? `${mutual} mutual ${mutual === 1 ? 'friend' : 'friends'}` : 'No mutual friends yet';
  const avatar = person.avatarUrl
    ? `<img src="${esc(person.avatarUrl)}" alt="">`
    : esc(person.avatar || String(person.name || '?').slice(0, 1).toUpperCase());
  return `<div class="sheet-backdrop people-layer" data-close-people-backdrop><section class="sheet people-sheet people-flow-sheet people-discovery-profile" role="dialog" aria-modal="true" aria-label="${esc(person.name || 'Donezo user')} profile" data-sheet><div class="sheet-handle"></div><div class="sheet-head"><div><button class="settings-back" type="button" data-people-discovery-back>‹ People</button><h2>${esc(person.name || 'Donezo user')}</h2></div><button class="icon-btn" type="button" data-close-people aria-label="Close">×</button></div><div class="people-discovery-profile-body"><span class="avatar people-discovery-profile-avatar">${avatar}</span><strong>${esc(person.name || 'Donezo user')}</strong>${handle ? `<span>${esc(handle)}</span>` : ''}<small>${esc(mutualCopy)}</small><div class="people-discovery-profile-action">${peopleRelationshipAction(person)}</div></div></section></div>`;
}

function openPeoplePerson(person) {
  if (!person?.id) return;
  const alreadyFriend = person.relationship === 'friend' || friendList(getState()).some((friend) => friend.id === person.id);
  if (alreadyFriend) {
    discoveryProfilePerson = null;
    openFriendProfile(person.id);
    return;
  }
  discoveryProfilePerson = { ...person };
  refreshPeopleSheet();
}

'''
replace_once('\nfunction peopleSheet() {', '\n' + insert + 'function peopleSheet() {', 'discovery profile helpers')

replace_once(
    "function peopleSheet() {\n  if (!peopleSheetOpen || friendProfileUserId || inviteSheetOpen) return '';\n  const state = getState();",
    "function peopleSheet() {\n  if (!peopleSheetOpen || friendProfileUserId || inviteSheetOpen) return '';\n  if (discoveryProfilePerson) return discoveryProfileSheet();\n  const state = getState();",
    'discovery profile routing',
)

replace_once(
    "  peopleSuggestionsLoading = false;\n  clearTimeout(peopleSearchDebounceTimer);",
    "  peopleSuggestionsLoading = false;\n  discoveryProfilePerson = null;\n  clearTimeout(peopleSearchDebounceTimer);",
    'close People discovery reset',
)

replace_once(
    "function syncPeopleRelationship(userId, relationship, requestId = null) {\n  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: requestId ?? person.requestId ?? null } : person;\n  peopleSearchResults = peopleSearchResults.map(patch);\n  peopleSuggestions = peopleSuggestions.map(patch);\n}",
    "function syncPeopleRelationship(userId, relationship, requestId = null) {\n  const patch = (person) => person.id === userId ? { ...person, relationship, requestId: requestId ?? person.requestId ?? null } : person;\n  peopleSearchResults = peopleSearchResults.map(patch);\n  peopleSuggestions = peopleSuggestions.map(patch);\n  if (discoveryProfilePerson?.id === userId) discoveryProfilePerson = patch(discoveryProfilePerson);\n}",
    'discovery relationship sync',
)

old_identity_binding = '''  sheet.querySelectorAll('[data-people-person]').forEach((element) => { element.onclick = () => {
    const person = [...peopleSearchResults, ...peopleSuggestions].find((item) => item.id === element.dataset.peoplePerson)
      || friendList(getState()).find((item) => item.id === element.dataset.peoplePerson);
    if (person?.relationship === 'friend' || friendList(getState()).some((item) => item.id === element.dataset.peoplePerson)) openFriendProfile(element.dataset.peoplePerson);
  }; });'''
new_identity_binding = '''  sheet.querySelector('[data-people-discovery-back]')?.addEventListener('click', () => {
    discoveryProfilePerson = null;
    refreshPeopleSheet();
  });
  sheet.querySelectorAll('[data-people-person]').forEach((element) => { element.onclick = () => {
    const rawFriend = friendList(getState()).find((item) => item.id === element.dataset.peoplePerson);
    const person = [...peopleSearchResults, ...peopleSuggestions].find((item) => item.id === element.dataset.peoplePerson)
      || (rawFriend ? { ...rawFriend, relationship: 'friend' } : null);
    openPeoplePerson(person);
  }; });'''
replace_once(old_identity_binding, new_identity_binding, 'People identity routing')

replace_once(
    "  peopleSuggestions = [];\n  peopleSuggestionsLoading = false;\n  commentCheckInId = null;",
    "  peopleSuggestions = [];\n  peopleSuggestionsLoading = false;\n  discoveryProfilePerson = null;\n  commentCheckInId = null;",
    'global close discovery reset',
)

username_handler = r'''async function handleUsernameSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector('[name="username"]');
  const submit = event.currentTarget.querySelector('button[type="submit"], button:not([type])');
  const raw = String(input?.value || '').trim();
  if (networkBootLoading || !authoritativeReady) {
    notify('Refreshing your latest data…', 2200);
    return;
  }
  if (!online) {
    notify('You are offline. Nothing was saved yet.', 3200);
    return;
  }
  if (submit) {
    submit.disabled = true;
    submit.dataset.originalLabel = submit.textContent;
    submit.textContent = 'Saving…';
  }
  try {
    const saved = await repo.setMyUsername(raw);
    if (input) input.value = saved;
    scheduleStateCacheWrite();
    notify(`Username saved · @${saved}`);
  } catch (error) {
    notify(readableError(error), 3600);
    input?.focus({ preventScroll: true });
    input?.select?.();
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = submit.dataset.originalLabel || 'Save username';
      delete submit.dataset.originalLabel;
    }
  }
}

'''
replace_once('\nasync function handleDisplayName(event) {', '\n' + username_handler + 'async function handleDisplayName(event) {', 'username submit handler')

replace_once(
    "  app.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);",
    "  app.querySelector('#display-name-form')?.addEventListener('submit', handleDisplayName);\n  app.querySelector('#username-form')?.addEventListener('submit', handleUsernameSubmit);",
    'username form binding',
)

css += r'''

/* Username and privacy-safe discovery profile */
.username-form{margin-top:var(--space-3);padding-top:var(--space-3);border-top:var(--rule-hairline) solid var(--color-rule)}.username-input-wrap{display:flex;align-items:center;min-height:2.9rem;margin-top:.35rem;border:var(--rule-hairline) solid var(--color-rule-strong);border-radius:var(--radius-md);background:var(--color-surface);overflow:hidden}.username-input-wrap>span{padding-left:.8rem;color:var(--color-muted);font-weight:800}.username-input-wrap input{flex:1;min-width:0;min-height:2.8rem;padding:.7rem .8rem .7rem .22rem;border:0!important;outline:0;background:transparent!important;color:var(--color-ink);font:inherit}.people-discovery-profile-body{display:flex;flex-direction:column;align-items:center;gap:.35rem;padding:var(--space-6) var(--space-3);text-align:center}.people-discovery-profile-avatar{width:5.25rem;height:5.25rem;margin-bottom:var(--space-2);font-size:1.45rem;overflow:hidden}.people-discovery-profile-avatar img{width:100%;height:100%;object-fit:cover}.people-discovery-profile-body>strong{font-size:var(--text-lg)}.people-discovery-profile-body>span:not(.avatar){color:var(--color-muted);font-family:var(--font-mono);font-size:var(--text-sm)}.people-discovery-profile-body>small{color:var(--color-muted);font-size:var(--text-xs)}.people-discovery-profile-action{width:min(16rem,100%);margin-top:var(--space-3)}.people-discovery-profile-action>.btn{width:100%}
'''

app_path.write_text(text)
css_path.write_text(css)
