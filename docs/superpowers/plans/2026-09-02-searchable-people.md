# Searchable People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Donezo accounts discoverable by safe server-side username/display-name search, add mutual-friend suggestions and prominent request handling inside the existing People surface, and give every account an editable unique username.

**Architecture:** Keep `public.profiles` RLS restrictive and expose discovery only through bounded `SECURITY DEFINER` RPCs. Search/suggestion results stay transient in the People overlay rather than entering global app state, while existing `inviteFriend` / `acceptFriend` remain relationship authorities. The Friends proof feed stays mounted underneath People so search, add, accept, and profile drill-downs do not destroy feed scroll or signed-image state.

**Tech Stack:** Vanilla JavaScript ES modules, Supabase JS/Postgres/RLS/RPCs, Node `node:test`, CSS, Vercel PWA.

**Spec:** `docs/superpowers/specs/2026-09-02-searchable-people-design.md`

## Global Constraints

- Every profile has a unique normalized username; signup does not ask the user to choose one.
- Username format: lowercase, 3–30 chars, only `a-z`, `0-9`, `_`, `.`, first character alphanumeric.
- Reserved usernames include at minimum `admin`, `administrator`, `donezo`, `support`, `system`.
- Search matches username and display name only; never email or phone.
- Search starts at 2 normalized characters, ignores a leading `@`, debounces about 250 ms, and returns at most 20 rows.
- Search ranking: exact username → username prefix → display-name prefix → display-name substring → higher mutual count → stable name/id tie-break.
- Suggestions contain only non-friends with at least one mutual direct friend; no random zero-mutual users.
- `profiles` never becomes globally selectable; discovery uses restricted authenticated RPCs only.
- Discovery rows expose only `user_id`, `username`, `display_name`, `avatar_url`, `relationship_status`, `request_id`, and `mutual_count`.
- Search visibility never authorizes proofs, habits, streaks, activity, or full friend lists.
- Existing invite links/code redemption remain supported.
- No new bottom-navigation tab.
- People search/suggestion calls never trigger the full repository `load()` and never enter the app-wide state cache.
- Opening/searching/mutating/closing People must not rebuild the Friends proof feed underneath.
- V1 adds no contact-book import, email/phone discovery, blocking, private accounts, discoverability opt-out, fuzzy/trigram infra, or username cooldown.

---

## File Structure

- Create `supabase/migrations/20260902195000_searchable_people.sql` — username invariants, backfill/assignment, corrected pending-request profile policy, username setter RPC, search RPC, suggestion RPC, execute grants.
- Create `test/searchable-people.test.mjs` — migration/repository/UI regression contract for this feature.
- Modify `src/store.js` — safe discovery-row mapper, production `searchPeople`, `suggestPeople`, `setMyUsername`, deterministic memory equivalents.
- Modify `src/app.js` — transient People discovery state, request badge, overlay-local rendering/search, relationship actions, minimal non-friend discovery profile, username settings handler.
- Modify `social.css` — full-height People discovery/search/results/default sections and discovery-profile styles using existing semantic tokens.
- Modify existing Friends/profile/settings regression tests only where an old assertion encodes behavior intentionally replaced by this design.

---

### Task 1: Database username and discovery contract

**Files:**
- Create: `supabase/migrations/20260902195000_searchable_people.sql`
- Create: `test/searchable-people.test.mjs`

**Interfaces:**
- Produces: `public.set_my_username(desired_username text) returns text`.
- Produces: `public.search_people(search_query text, result_limit integer default 20)` returning the seven safe discovery columns.
- Produces: `public.suggest_people(result_limit integer default 10)` returning the same seven columns.
- Produces invariant: every `public.profiles.username` is non-null, normalized, unique, valid, and non-reserved.
- Repairs invariant: pending friend-request participants are selectable by existing profile RLS using the outer profile id, not the inner request id.

- [ ] **Step 1: Write migration contract tests before the migration exists**

Add `test/searchable-people.test.mjs` with an initial migration-focused block:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../supabase/migrations/20260902195000_searchable_people.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

test('searchable People migration makes usernames required and safe', () => {
  assert.match(migration, /alter table public\.profiles[\s\S]*username[\s\S]*not null/i);
  assert.match(migration, /\^\[a-z0-9\]/i);
  for (const name of ['admin', 'administrator', 'donezo', 'support', 'system']) {
    assert.match(migration, new RegExp(name, 'i'));
  }
  assert.match(migration, /unique/i);
});

test('discovery stays behind bounded authenticated RPCs', () => {
  assert.match(migration, /create or replace function public\.search_people\(search_query text, result_limit integer default 20\)/i);
  assert.match(migration, /create or replace function public\.suggest_people\(result_limit integer default 10\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path\s*=\s*''/i);
  assert.match(migration, /least\(20/i);
  assert.match(migration, /length\([^)]*\)\s*<\s*2/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+public\.profiles\s+to\s+authenticated/i);
  assert.match(migration, /grant execute on function public\.search_people/i);
  assert.match(migration, /grant execute on function public\.suggest_people/i);
});

test('discovery RPC result contract exposes no private columns', () => {
  for (const column of ['user_id uuid', 'username text', 'display_name text', 'avatar_url text', 'relationship_status text', 'request_id uuid', 'mutual_count bigint']) {
    assert.match(migration, new RegExp(column.replace(' ', '\\s+'), 'i'));
  }
  assert.doesNotMatch(migration, /returns table[\s\S]{0,500}\b(email|phone|timezone|recap_awards_enabled)\b/i);
});

test('profile pending-request RLS compares friend requests to the outer profile id', () => {
  assert.match(migration, /profiles_select_friends_or_requests/i);
  assert.match(migration, /request\.requester_id\s*=\s*profile_row\.id|request\.requester_id\s*=\s*profiles\.id/i);
  assert.doesNotMatch(migration, /request\.requester_id\s*=\s*request\.id/i);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test/searchable-people.test.mjs
```

Expected: FAIL because `20260902195000_searchable_people.sql` does not exist / is empty.

- [ ] **Step 3: Implement username normalization, assignment, backfill, constraints, and RLS repair**

Create `supabase/migrations/20260902195000_searchable_people.sql`. Use a database-owned normalizer and assignment trigger so `ensureProfile()` can continue inserting only `id`, `display_name`, and `timezone`.

Core shape:

```sql
create or replace function private.normalize_donezo_username(raw_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    trim(both '._' from regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9._]+', '_', 'g')),
    ''
  );
$$;

create or replace function private.generated_donezo_username(target_display_name text, target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text := replace(target_user_id::text, '-', '');
  suffix_length integer := 6;
begin
  base := coalesce(private.normalize_donezo_username(target_display_name), 'user');
  if base !~ '^[a-z0-9]' then base := 'user_' || base; end if;
  base := left(base, 30);
  if length(base) < 3 then base := rpad(base, 3, '0'); end if;

  candidate := base;
  while candidate in ('admin','administrator','donezo','support','system')
     or exists (select 1 from public.profiles p where p.username = candidate and p.id <> target_user_id)
  loop
    candidate := left(base, 30 - suffix_length - 1) || '_' || left(suffix, suffix_length);
    suffix_length := least(20, suffix_length + 2);
  end loop;
  return candidate;
end;
$$;
```

Backfill before `NOT NULL`:

```sql
update public.profiles p
set username = private.generated_donezo_username(p.display_name, p.id)
where p.username is null or btrim(p.username) = '';
```

Add a `BEFORE INSERT` trigger that assigns a generated username only when `new.username` is null/blank. Add/replace a check constraint equivalent to:

```sql
username ~ '^[a-z0-9][a-z0-9._]{2,29}$'
and username not in ('admin','administrator','donezo','support','system')
```

Then set `username NOT NULL`. Preserve the existing unique constraint; if the migration must recreate it, keep uniqueness on normalized stored values.

Repair `profiles_select_friends_or_requests` by explicitly naming the outer profile row in the pending-request clause. The policy must express the equivalent of:

```sql
exists (
  select 1
  from public.friend_requests request
  where request.status = 'pending'
    and (
      (request.requester_id = profiles.id and request.addressee_id = (select auth.uid()))
      or
      (request.addressee_id = profiles.id and request.requester_id = (select auth.uid()))
    )
)
```

- [ ] **Step 4: Implement the authenticated username setter**

Add:

```sql
create or replace function public.set_my_username(desired_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized text := private.normalize_donezo_username(desired_username);
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if normalized is null or normalized !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception 'Username must be 3-30 characters using letters, numbers, dots, or underscores';
  end if;
  if normalized in ('admin','administrator','donezo','support','system') then
    raise exception 'Username is reserved';
  end if;
  if exists (select 1 from public.profiles p where p.username = normalized and p.id <> actor) then
    raise exception 'Username is taken';
  end if;
  update public.profiles set username = normalized, updated_at = now() where id = actor;
  return normalized;
end;
$$;
```

Revoke from `public, anon`; grant execute to `authenticated` only.

- [ ] **Step 5: Implement `search_people` with relationship state and ranking**

Normalize `search_query` by trimming, lowercasing, and removing one leading `@`. Return zero rows when normalized length < 2. Clamp `result_limit` to `greatest(1, least(20, coalesce(result_limit, 20)))`.

For each candidate profile other than `auth.uid()` compute:

```text
friend       -> private.are_direct_friends(actor, candidate)
incoming     -> pending request candidate -> actor
outgoing     -> pending request actor -> candidate
available    -> otherwise
```

Return the pending request id for incoming/outgoing, null otherwise. Compute mutual count as the intersection of the actor's and candidate's direct-friend ids without returning those ids.

Filter with:

```sql
p.username = normalized_query
or p.username like normalized_query || '%'
or lower(p.display_name) like normalized_query || '%'
or lower(p.display_name) like '%' || normalized_query || '%'
```

Order with explicit rank cases matching the spec, then `mutual_count desc`, `lower(display_name)`, `p.id`.

- [ ] **Step 6: Implement `suggest_people`**

Return the same safe row shape. Exclude self and current direct friends. Require `mutual_count > 0`. Order by mutual count descending, then stable display name/id. Clamp to 1–10 by default and never exceed 20 even if a caller passes a larger value.

- [ ] **Step 7: Lock down function privileges**

For `set_my_username`, `search_people`, and `suggest_people`:

```sql
revoke all on function ... from public, anon;
grant execute on function ... to authenticated;
```

Do not add a `profiles SELECT` grant.

- [ ] **Step 8: Run focused migration tests to GREEN**

Run:

```bash
node --test test/searchable-people.test.mjs
```

Expected: all Task 1 tests PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add supabase/migrations/20260902195000_searchable_people.sql test/searchable-people.test.mjs
git commit -m "feat: add safe people discovery database contract"
```

---

### Task 2: Repository discovery and username APIs

**Files:**
- Modify: `src/store.js`
- Modify: `test/searchable-people.test.mjs`

**Interfaces:**
- Consumes DB RPCs from Task 1.
- Produces `searchPeople(query, limit = 20) -> Promise<DiscoveryPerson[]>`.
- Produces `suggestPeople(limit = 10) -> Promise<DiscoveryPerson[]>`.
- Produces `setMyUsername(username) -> Promise<string>`.
- `DiscoveryPerson` client shape is `{ id, name, handle, username, avatar, avatarUrl, relationship, requestId, mutualCount }`.

- [ ] **Step 1: Add failing production repository contract tests**

Append source-level tests:

```js
const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

test('production repository exposes transient discovery RPC methods without full load', () => {
  for (const [name, rpc] of [
    ['searchPeople', 'search_people'],
    ['suggestPeople', 'suggest_people'],
    ['setMyUsername', 'set_my_username'],
  ]) {
    assert.match(store, new RegExp(`(?:async\\s+)?function ${name}\\(`));
    const start = store.indexOf(`function ${name}(`);
    const body = store.slice(start, store.indexOf('\n  }', start) + 4);
    assert.match(body, new RegExp(`rpc\\(['\"]${rpc}['\"]`));
    if (name !== 'setMyUsername') assert.doesNotMatch(body, /\bload\s*\(/);
  }
});

test('discovery rows map only the safe public person shape', () => {
  assert.match(store, /function mapDiscoveryPerson\(/);
  for (const field of ['user_id', 'username', 'display_name', 'avatar_url', 'relationship_status', 'request_id', 'mutual_count']) {
    assert.match(store, new RegExp(field));
  }
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/searchable-people.test.mjs
```

Expected: repository-method tests FAIL because the methods do not exist.

- [ ] **Step 3: Add one shared discovery mapper**

Near existing profile/member mappers add:

```js
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
```

Reuse it in `loadFriendConnections` where practical so search/suggestions/FOF rows have identical field semantics.

- [ ] **Step 4: Add production repository methods**

Inside `createSupabaseRepository`:

```js
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
  if (state.currentUserId === user.id) {
    const patch = (person) => person?.id === user.id ? { ...person, username: saved, handle: `@${saved}` } : person;
    state.members = (state.members || []).map(patch);
    state.personalizedLeague = (state.personalizedLeague || []).map(patch);
    state.peopleDirectory = (state.peopleDirectory || []).map(patch);
  }
  return saved;
}
```

Export all three in the repository return object. Do not call `load()` from search/suggest.

- [ ] **Step 5: Add deterministic memory equivalents**

Inside `createMemoryRepository`, implement `searchPeople`, `suggestPeople`, and `setMyUsername` against `state.profiles || state.members || []`. Match the production safe shape and ranking enough for domain tests:

- omit current user;
- case-insensitive username/display-name matching;
- relationship state from `state.friendships` and pending `state.friendRequests`;
- mutual count from direct-friend intersections;
- suggestions require `mutualCount > 0` and exclude current friends;
- `setMyUsername` normalizes/validates/reserves/conflicts and updates only the current profile.

Expose these methods in the memory repository return object.

- [ ] **Step 6: Add memory behavior tests**

Add a small seeded graph test proving:

```js
const results = repo.searchPeople('@ali');
assert.equal(results[0].username, 'alice');
assert.equal(results[0].relationship, 'available');
assert.equal(results[0].mutualCount, 1);

const suggestions = repo.suggestPeople();
assert.ok(suggestions.every((person) => person.mutualCount > 0));

repo.asUser('alice');
assert.equal(repo.setMyUsername('Alice.New'), 'alice.new');
```

Also assert conflicts/reserved names throw.

- [ ] **Step 7: Run focused tests to GREEN**

```bash
node --test test/searchable-people.test.mjs test/friends-foundation.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/store.js test/searchable-people.test.mjs
git commit -m "feat: add people discovery repository APIs"
```

---

### Task 3: Full-height People search and request/suggestion UI

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Modify: `test/searchable-people.test.mjs`
- Modify as needed: `test/fluid-performance.test.mjs`, `test/league-friends-ux.test.mjs`, `test/mobile-social-proof-polish.test.mjs`

**Interfaces:**
- Consumes `repo.searchPeople`, `repo.suggestPeople`, `repo.inviteFriend`, `repo.acceptFriend`.
- Produces overlay-local People state and renderer.
- Produces `openPeopleSheet()`, `closePeopleSheet()`, `refreshPeopleSheet()`, `queuePeopleSearch(query)`, `loadPeopleSuggestions()`.
- Produces person-row relationship states `available | outgoing | incoming | friend` displayed as `Add | Requested | Accept | Friends`.

- [ ] **Step 1: Add failing UI contract tests**

Add tests that inspect `src/app.js` and `social.css`:

```js
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.css', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return source.slice(from, to);
}

test('People is a full-height searchable overlay with request badge and no new bottom tab', () => {
  const friends = section(app, 'function friendsScreen()', 'function challengeProgress');
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  assert.match(friends, /data-people-open/);
  assert.match(friends, /people-request-badge/);
  assert.match(people, /name="peopleSearch"/);
  assert.match(people, /placeholder="Search people"/);
  assert.doesNotMatch(people, /autofocus/);
  assert.match(social, /\.people-sheet[\s\S]*height:/);
  const nav = section(app, 'function nav()', 'function openCheckInAction');
  assert.doesNotMatch(nav, /People/);
});

test('default People view orders Requests Suggestions Friends and keeps invite fallback', () => {
  const people = section(app, 'function peopleSheet()', 'function proofRejectSheet');
  const requests = people.indexOf('Requests');
  const suggested = people.indexOf('Suggested for you');
  const friends = people.indexOf('Friends');
  assert.ok(requests >= 0 && suggested > requests && friends > suggested);
  assert.match(people, /Have an invite code/);
  assert.match(people, /data-invite-from-people/);
});

test('People search is 2-character debounced latest-query-wins and overlay-local', () => {
  assert.match(app, /250/);
  assert.match(app, /peopleSearchRequestId/);
  assert.match(app, /queuePeopleSearch/);
  const open = section(app, 'function openPeopleSheet(', 'function proofRejectSheet');
  assert.doesNotMatch(open, /render\(\)/);
  assert.match(open, /insertAdjacentHTML|replaceWith|refreshPeopleSheet/);
});
```

- [ ] **Step 2: Run focused UI tests and verify RED**

```bash
node --test test/searchable-people.test.mjs
```

Expected: new People UI tests FAIL.

- [ ] **Step 3: Add transient People state**

Near existing `peopleSheetOpen` state add exactly one compact state object or equivalent fields:

```js
let peopleSearchQuery = '';
let peopleSearchResults = [];
let peopleSearchLoading = false;
let peopleSuggestions = [];
let peopleSuggestionsLoading = false;
let peopleSearchRequestId = 0;
let peopleSearchDebounceTimer = null;
let discoveryProfilePerson = null;
```

Reset these on sign-out/boot as appropriate. Do not put them in repository/global cache state.

- [ ] **Step 4: Add relationship row helpers**

Create shared UI helpers such as:

```js
function peopleRelationshipAction(person) {
  if (person.relationship === 'friend') return '<button class="btn small-btn" disabled>Friends</button>';
  if (person.relationship === 'outgoing') return '<button class="btn small-btn" disabled>Requested</button>';
  if (person.relationship === 'incoming') return `<button class="btn primary small-btn" data-people-accept="${person.requestId}">Accept</button>`;
  return `<button class="btn primary small-btn" data-people-add="${person.id}">Add</button>`;
}
```

and one `peoplePersonRow(person)` shared by suggestions/search. Render avatar, name, `@username`, optional mutual count, and relationship action.

- [ ] **Step 5: Rebuild `peopleSheet()` default/search states**

Keep the existing Friends entry point but change the sheet into a full-height People surface. Header has title `People` and compact share-invite action. Immediately below:

```html
<label class="people-search">
  <span aria-hidden="true">⌕</span>
  <input name="peopleSearch" type="search" placeholder="Search people" autocomplete="off" spellcheck="false">
</label>
```

No autofocus.

When normalized query length < 2, render non-empty sections in this order:

1. incoming `state.friendRequests` rows where current user is addressee and status is pending;
2. `peopleSuggestions`;
3. `friendList(state)` excluding self;
4. `Have an invite code?` fallback.

When query length >= 2, render only search state/results plus the header/search field.

- [ ] **Step 6: Mount/refresh People locally without rebuilding Friends**

Follow the reply-overlay pattern already introduced in PR #70:

```js
function refreshPeopleSheet() {
  const current = app.querySelector('.people-sheet')?.closest('.sheet-backdrop');
  if (!peopleSheetOpen || !current) return;
  current.outerHTML = peopleSheet();
  bindPeopleSheetActions();
}

function openPeopleSheet() {
  peopleSheetOpen = true;
  app.querySelector('.app-shell')?.insertAdjacentHTML('beforeend', peopleSheet());
  bindPeopleSheetActions();
  void loadPeopleSuggestions();
}
```

Use a DOM replacement/mount strategy that preserves `#content-scroll`, proof card DOM, and signed proof images. `closePeopleSheet()` removes only the People overlay and clears search timers/request ids.

Update `[data-people-open]` binding to call `openPeopleSheet()` instead of full `render()`.

- [ ] **Step 7: Implement debounced latest-query-wins search**

On input:

```js
function queuePeopleSearch(rawQuery) {
  peopleSearchQuery = rawQuery;
  clearTimeout(peopleSearchDebounceTimer);
  const normalized = rawQuery.trim().replace(/^@/, '').toLowerCase();
  if (normalized.length < 2) {
    peopleSearchResults = [];
    peopleSearchLoading = false;
    refreshPeopleSheet();
    return;
  }
  peopleSearchLoading = true;
  refreshPeopleSheet();
  const requestId = ++peopleSearchRequestId;
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
```

When refreshing after input, preserve search input value, focus, and selection range so typing does not lose the keyboard/caret. Prefer updating only the People content/results node rather than replacing the input node on every keystroke.

- [ ] **Step 8: Load suggestions only when People opens**

`loadPeopleSuggestions()` sets local loading state, calls `repo.suggestPeople(10)`, ignores completion if People was closed or a newer request superseded it, and refreshes only People. Failure hides/replaces Suggestions and leaves Requests/Friends intact.

- [ ] **Step 9: Add overlay-local Add/Accept mutations**

For Add:

1. find the person in local results/suggestions;
2. optimistically set `relationship: 'outgoing'` and render `Requested`;
3. `await repo.inviteFriend(person.id)`;
4. on failure restore `available` and notify;
5. after success, synchronize matching rows in both search and suggestions.

For Accept:

1. optimistically mark `friend`;
2. `await repo.acceptFriend(person.requestId)`;
3. on failure restore `incoming`;
4. on success remove the matching request from the visible request section, refresh local rows, and use updated repository state for the Friends section.

Do not call global `render()` from these handlers.

- [ ] **Step 10: Add People request badge**

In `friendsScreen()` compute pending incoming request count from `getState().friendRequests` and render a compact `.people-request-badge` inside the existing People icon button. Badge semantics are pending incoming requests only; cap visual text at `9+` if desired.

- [ ] **Step 11: Add focused People CSS**

Use existing tokens only. Add styles for:

```text
.people-sheet / .people-discovery-sheet
.people-search
.people-section
.people-section-head
.people-discovery-row
.people-discovery-meta
.people-request-badge
.people-search-loading
.people-search-empty
.people-invite-fallback
```

The sheet should occupy the stable mobile People flow height/full-height secondary-screen treatment already used by `.people-flow-sheet`, respect safe areas, keep the search field sticky, and avoid horizontal overflow.

- [ ] **Step 12: Update old tests that encode the replaced two-button People layout**

Where existing tests require only `Invite friends` + `Add by link` as the main People contents, change them narrowly so they require those invite paths to remain accessible but allow Requests/Suggestions/Friends/search above them. Do not weaken unrelated Friends feed assertions.

- [ ] **Step 13: Run UI + existing Friends regressions to GREEN**

```bash
node --test test/searchable-people.test.mjs test/friends-foundation.test.mjs test/league-friends-ux.test.mjs test/mobile-social-proof-polish.test.mjs test/fluid-performance.test.mjs
```

Expected: PASS.

- [ ] **Step 14: Commit Task 3**

```bash
git add src/app.js social.css test/searchable-people.test.mjs test/friends-foundation.test.mjs test/league-friends-ux.test.mjs test/mobile-social-proof-polish.test.mjs test/fluid-performance.test.mjs
git commit -m "feat: add searchable People experience"
```

---

### Task 4: Username settings and privacy-safe discovery profile

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Modify: `test/searchable-people.test.mjs`

**Interfaces:**
- Consumes `repo.setMyUsername(username)` from Task 2.
- Produces editable username field inside Settings → Profile & app.
- Produces minimal `discoveryProfilePerson` overlay for non-friends only.
- Direct friends still route to existing `openFriendProfile(userId)`.

- [ ] **Step 1: Add failing username-settings and privacy-profile tests**

```js
test('Profile & app exposes an editable username backed by setMyUsername', () => {
  const settings = section(app, 'function settingsSheet()', 'function nudgeComposerSheet()');
  assert.match(settings, /name="username"/);
  assert.match(app, /setMyUsername/);
});

test('non-friend discovery profile is intentionally minimal', () => {
  const discovery = section(app, 'function discoveryProfileSheet()', 'function proofRejectSheet');
  for (const safe of ['username', 'mutual', 'relationship']) assert.match(discovery, new RegExp(safe, 'i'));
  assert.doesNotMatch(discovery, /personProofCarousel|currentStreak|weeklyCompletionScore|activityList|habit/i);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test/searchable-people.test.mjs
```

Expected: the new Task 4 tests FAIL.

- [ ] **Step 3: Add username form to Profile & app**

Keep the existing display-name form. Add a separate form directly below it:

```html
<form id="username-form" class="form sheet-form">
  <label>Username
    <div class="username-input-wrap"><span>@</span><input name="username" value="${esc((me().handle || '').replace(/^@/, ''))}" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._]{2,29}" autocapitalize="none" autocomplete="off" required></div>
  </label>
  <small>People can find you by this.</small>
  <button class="btn full">Save username</button>
</form>
```

Do not expose or derive email here.

- [ ] **Step 4: Add username submit handler**

Create:

```js
async function handleUsernameSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const raw = String(form.get('username') || '').trim();
  try {
    const saved = await repo.setMyUsername(raw);
    scheduleStateCacheWrite();
    notify(`Username saved · @${saved}`);
    renderPreservingScroll();
  } catch (error) {
    notify(readableError(error), 3600);
  }
}
```

Bind `#username-form`. Preserve typed input on conflict by patching the visible field/error locally or ensuring the handler does not rerender Settings on failure.

- [ ] **Step 5: Add minimal discovery profile routing**

Make discovery result row identity tappable. Add a router:

```js
function openPeoplePerson(person) {
  if (person.relationship === 'friend') {
    openFriendProfile(person.id);
    return;
  }
  discoveryProfilePerson = { ...person };
  refreshPeopleSheet();
}
```

`discoveryProfileSheet()` contains only avatar, display name, handle, mutual count, and the same relationship action. No habits/proofs/streak/activity/friend-list functions may be called from it.

Closing this profile returns to the current People query/results without reloading or losing the keyboard/search state.

- [ ] **Step 6: Add CSS for username and discovery profile**

Add scoped styles for `.username-input-wrap` and `.people-discovery-profile`; reuse existing avatar/button/sheet tokens and safe areas.

- [ ] **Step 7: Run focused Task 4 tests to GREEN**

```bash
node --test test/searchable-people.test.mjs test/league-friends-ux.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/app.js social.css test/searchable-people.test.mjs
git commit -m "feat: add usernames and discovery profiles"
```

---

### Task 5: Full verification, live migration, and rollout

**Files:**
- No new product files expected; only fix regressions found by verification.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified PR-ready implementation and live database contract.

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: 0 failures.

- [ ] **Step 2: Run static checks**

```bash
npm run check
```

Expected: exit 0.

- [ ] **Step 3: Run production build**

```bash
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_only \
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Inspect migration against the live pre-migration schema before applying**

Verify live facts still match assumptions:

```sql
select column_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='profiles';

select policyname, qual
from pg_policies
where schemaname='public' and tablename='profiles';
```

Confirm the current pending-request policy still contains the known erroneous inner `request.id` comparison before replacing it.

- [ ] **Step 5: Apply the migration to Donezo production Supabase**

Apply the exact repository SQL from `supabase/migrations/20260902195000_searchable_people.sql` with the Supabase migration action. Do not manually edit a divergent SQL variant.

- [ ] **Step 6: Verify live database invariants immediately after migration**

Run read-only verification queries:

```sql
select count(*) as missing_usernames from public.profiles where username is null;
select username, count(*) from public.profiles group by username having count(*) > 1;
select count(*) as invalid_usernames from public.profiles
where username !~ '^[a-z0-9][a-z0-9._]{2,29}$';
```

Expected: all counts 0 / no duplicate rows.

Inspect `pg_get_functiondef` for `search_people`, `suggest_people`, `set_my_username`, and inspect the corrected `profiles_select_friends_or_requests` policy. Verify direct `profiles` RLS remains enabled and no authenticated global SELECT grant was added.

- [ ] **Step 7: Run Supabase security and performance advisors**

Check both advisor types. Fix any new migration-caused security issue before PR/merge. Performance warnings unrelated to this migration may be documented, but a missing essential search index or RLS warning caused by this change must be fixed.

- [ ] **Step 8: Open PR and verify exact-head CI/Vercel preview**

PR summary must mention:

- generated/editable usernames;
- safe bounded RPC search;
- mutual-only suggestions;
- request badge and People overlay-local UX;
- corrected pending-request profile RLS;
- privacy-safe stranger profile;
- existing invite links preserved.

Wait for standard CI on the exact PR head and confirm Vercel preview state is `READY` for that same SHA.

- [ ] **Step 9: Perform pre-merge code review**

Review the PR patch specifically for:

- no private columns in discovery RPCs;
- no global profiles SELECT widening;
- no empty-query user enumeration;
- username uniqueness/race safety;
- pending request relationship direction correctness;
- no Friends feed `render()` on People open/search/add/accept/close;
- no stranger proof/activity exposure;
- no stale search response overwrite;
- no username form loss on conflict.

Fix all Critical/Important findings and rerun the full verification gate.

- [ ] **Step 10: Squash merge with expected-head protection**

Merge only the reviewed exact head.

- [ ] **Step 11: Verify post-merge main CI and production deployment**

Confirm:

- main CI completes successfully for the merge SHA;
- Vercel production deployment is `READY` and references the merge SHA;
- Supabase functions/policy remain the exact verified definitions.

- [ ] **Step 12: Manual iPhone PWA acceptance**

Using two real test accounts:

1. open Friends, scroll deep into proofs, open/close People, confirm exact feed position is preserved;
2. type searches quickly and confirm no stale result flashes after newer input;
3. search by `@username` and display name;
4. send request: `Add → Requested`;
5. receive/accept request: request badge appears and `Accept → Friends`;
6. rename username and immediately find the new username;
7. open a stranger discovery profile and verify no proofs/habits/streak/activity/friend list appears;
8. verify invite share and invite-code fallback still work;
9. check keyboard, safe area, dark mode, and small-screen layout.

- [ ] **Step 13: Final completion report**

Report the merge SHA, PR number, live migration verification, main CI result, production deployment result, and any manual-only check that still requires the user's physical iPhone. Do not claim physical-device behavior was verified unless it was actually exercised.
