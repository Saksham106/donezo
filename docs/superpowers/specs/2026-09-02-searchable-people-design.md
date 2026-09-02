# Searchable People Discovery Design

**Date:** 2026-09-02  
**Status:** Design for user review before implementation planning  
**Base:** `main` after PR #70 (`62fe24fef4339a22f82a7a26fa2e675e17ef0d35`)

## Goal

Make adding friends in Donezo feel closer to Instagram: every account is discoverable by a stable username and display name, people can be searched and added in a few taps, incoming requests are obvious, and the existing invite-link flow remains a useful fallback rather than the main way to find people.

This design deliberately does **not** add a fifth bottom-navigation tab. Friend discovery is important, but it is secondary to the daily Friends proof feed. The existing People button on Friends becomes the entry point to a much stronger People experience.

## Product decisions

1. Every Donezo profile gets a unique `@username` automatically. Signup remains frictionless; users do not choose a username during account creation.
2. Existing profiles are backfilled with generated usernames. At design time the production database has 8 profiles and all 8 currently have `username = null`.
3. A user can change their username later from **Profile & app**.
4. People search matches **username** and **display name** only. Email addresses and phone numbers are never searchable.
5. Search is server-side through restricted RPCs. We do not make the `profiles` table globally selectable and do not weaken the existing profile RLS policy.
6. The existing Friends People button opens a full-height People surface. No permanent navigation item is added.
7. Existing invite links and invite-code entry remain supported as fallback acquisition paths.
8. Searching for someone exposes only public discovery metadata. Habits, proofs, streaks, activity, and friend-only profile data remain unavailable until existing authorization permits them.

## User experience

### Friends entry point

The existing People icon on the Friends heading remains in the same place. If the current user has incoming friend requests, the icon gets a small numeric badge.

Tapping it opens a full-height, app-native **People** sheet/screen. It visually behaves like a secondary screen but preserves the Friends feed and its scroll position underneath, so closing People returns the user exactly where they were.

The header contains:

- back/close control;
- title: **People**;
- compact Share invite icon/action.

Immediately below is a sticky search field with placeholder text similar to **Search people**. Opening People does not automatically focus the input or summon the keyboard; the keyboard appears only after the user taps search.

### Default People view

With an empty search field, content appears in this order:

1. **Requests** — pending incoming friend requests, with `Accept` as the primary action.
2. **Suggested for you** — second-degree users who share at least one mutual friend, ordered primarily by mutual count. Do not fill the section with random global accounts when no mutual suggestions exist.
3. **Friends** — the current direct friend list.
4. A compact fallback action for **Have an invite code?**. Share invite remains available from the header.

Sections with zero rows disappear rather than showing multiple empty-state boxes.

The People icon badge counts pending incoming requests only. It is not a generic notification badge.

### Search behavior

Search begins after 2 normalized characters. Leading `@` is ignored. The client debounces queries by about 250 ms and cancels/ignores superseded responses.

The database returns at most 20 results. Ranking is:

1. exact username match;
2. username prefix match;
3. display-name prefix match;
4. display-name substring match;
5. higher mutual-friend count;
6. stable name/id tie-breaker.

Each result row contains:

- avatar;
- display name;
- `@username`;
- `N mutual friends` when mutual count is non-zero;
- one relationship action/state.

Relationship actions are:

- `Add` for an available person;
- `Requested` for an outgoing pending request;
- `Accept` for an incoming pending request;
- `Friends` for an existing friend.

The current user is omitted from results.

`Add` updates the row optimistically to `Requested`; failed requests roll the row back and show the existing concise Donezo error treatment. `Accept` updates immediately to `Friends` after the server accepts the request.

### Non-friend profile exposure

Tapping a search/suggestion result may open a minimal discovery profile view containing only:

- avatar;
- display name;
- username;
- mutual-friend count;
- relationship action/state.

Do not expose proof history, habits, streaks, activity, full friend lists, or other friend-authorized content to a stranger merely because they appeared in search.

Existing full friend profiles continue to work unchanged for authorized friends.

## Username model

### Format

Usernames are normalized to lowercase and are 3–30 characters. Allowed characters are:

- `a-z`
- `0-9`
- `_`
- `.`

The first character must be alphanumeric. Usernames are stored normalized, so the existing uniqueness rule can remain deterministic rather than depending on case-insensitive comparisons.

Reserved names include at minimum `admin`, `administrator`, `donezo`, `support`, and `system`.

### Automatic generation

A database-owned helper derives a base from `display_name`:

1. lowercase;
2. replace unsupported runs with `_`;
3. trim punctuation from the ends;
4. fall back to `user` if no usable characters remain;
5. trim to leave room for a collision suffix.

Try the readable base first. On collision, append a short deterministic/random-safe suffix and retry under the database uniqueness constraint. Generation happens server-side so all profile creation paths receive the same guarantee.

Existing null usernames are backfilled in the migration before adding a NOT NULL requirement.

New profiles receive a username automatically when inserted even if the client sends no username.

### Editing usernames

Profile & app adds a username field beneath display name. Saving calls a dedicated authenticated RPC such as `set_my_username(desired_username text)` rather than relying on arbitrary client-side profile writes.

The RPC:

- normalizes the input;
- validates length/characters/reserved names;
- rejects conflicts with a clear `Username is taken` error;
- updates only the caller's profile;
- returns the saved username.

No username-change cooldown is added in V1.

## Database architecture

### Migration

Add one migration after the current schema that:

1. backfills every existing null username;
2. adds/updates username format constraints;
3. makes `profiles.username` non-null after backfill;
4. keeps/enforces uniqueness;
5. creates a server-side username assignment trigger/helper for future profile inserts;
6. creates the authenticated `set_my_username` RPC;
7. creates `search_people`;
8. creates `suggest_people`;
9. preserves existing profile RLS and direct-friend authorization.

Do not grant authenticated users global `SELECT` on `profiles` as part of discovery.

### `search_people`

Exact interface:

```sql
public.search_people(
  search_query text,
  result_limit integer default 20
)
```

Return columns:

```text
user_id uuid
username text
display_name text
avatar_url text
relationship_status text
request_id uuid
mutual_count bigint
```

The function is `SECURITY DEFINER`, has `SET search_path = ''`, requires `auth.uid()`, clamps `result_limit` to 1–20, rejects/returns no results for normalized queries shorter than 2 characters, and never accepts an empty query as a list-all endpoint.

It computes relationship state from the existing `friendships` and pending `friend_requests` tables. It exposes no email, timezone, notification state, activity, habit, or proof columns.

### `suggest_people`

Exact interface:

```sql
public.suggest_people(result_limit integer default 10)
```

It returns the same safe row shape as search, excludes self/current friends, and only returns users with at least one mutual direct friend. It is also `SECURITY DEFINER` with a blank search path and a hard result cap.

V1 does not suggest arbitrary strangers with zero mutual connections.

### Search indexes

Add focused indexes for normalized username/display-name lookup only if query planning needs them. The production user count is currently tiny, so avoid adding `pg_trgm` or fuzzy-search infrastructure unless tests/query plans justify it. Prefix username matching and ordinary normalized display-name matching are sufficient for V1.

## Repository/client architecture

`src/store.js` gains transient operations rather than loading the global directory into normal application state:

```text
searchPeople(query)
suggestPeople()
setMyUsername(username)
```

Existing methods remain the authority for relationships:

```text
inviteFriend(userId)
acceptFriend(requestId)
```

Search and suggestion calls do not trigger a full `repo.load()` and do not add all discovered strangers to `peopleDirectory`. Results live only in the People discovery UI state.

The normal repository load still retrieves the current user's own profile, direct friends, relevant request participants, and other already-authorized data as it does today.

## People UI state

Keep discovery state separate from the Friends feed:

```text
peopleSheetOpen
peopleSearchQuery
peopleSearchResults
peopleSearchLoading
peopleSuggestions
peopleSuggestionsLoading
peopleSearchRequestId
peopleSearchDebounceTimer
```

The implementation may package these into one object/module if that makes `src/app.js` smaller, but the behavior is transient and overlay-local.

Opening, searching, adding, accepting, or closing People must not rebuild the Friends proof feed underneath it. People content can rerender locally inside its overlay.

A reusable person-row renderer should be shared by search results and suggestions so relationship-state behavior is identical. Existing friend-of-friend connection rows may adopt the same component where practical, without unrelated profile refactoring.

## Requests and invites

Existing friend-request semantics remain:

- `invite_friend` creates a pending request;
- `accept_friend` converts it into a direct friendship;
- existing share-link redemption can create a friendship according to its current semantics.

The new People screen does not replace invite links. It makes search the normal in-app discovery path while keeping link/code invites useful for bringing people into Donezo or finding someone externally.

No new push-notification category is required for V1. Incoming requests are surfaced prominently in People and with the People icon request badge. A later notification-specific improvement can be added independently.

## Privacy and abuse boundaries

1. Search results are intentionally discoverable to authenticated Donezo users, but only through the restricted RPC.
2. Email and phone are never searchable or returned.
3. Empty-query enumeration is disallowed.
4. Query length and result count are bounded.
5. Direct `profiles` RLS remains restrictive.
6. Search visibility alone never authorizes social content.
7. Mutual count is aggregate-only; search results do not return the identities of mutual friends.
8. Existing friend-of-friend APIs retain their current authorization boundaries.
9. Username setters operate only on the authenticated user's row.
10. Reserved usernames prevent impersonation of Donezo/system identities.

V1 does not add blocking, private accounts, or opt-out discoverability settings. Those would be separate product features and should not be silently invented as part of search.

## Loading, errors, and empty states

- Under 2 characters: show the default People view, not a search error.
- Searching: keep existing results visible with a small progress state or show a compact loading row; do not flash the whole screen empty.
- No matches: `No people found.` with no fake suggestions mixed into search results.
- Search failure: concise retryable error; current Friends/suggestions remain intact.
- Invite failure: roll `Requested` back to `Add`.
- Accept failure: preserve `Accept`.
- Username conflict: keep the typed value and show `Username is taken.`
- Suggestions failure: hide/replace only Suggestions, not Requests or Friends.

## Performance

- 250 ms search debounce.
- Latest-query-wins request ID so stale responses cannot overwrite newer text.
- Hard result limit 20.
- Suggested people loaded when People opens, not during global app boot.
- Search results never enter the normal app-wide cache/state envelope.
- Opening/closing People preserves Friends scroll position and loaded proof images.

## Migration and rollout

1. Ship database migration first or atomically with frontend compatibility.
2. Backfill usernames for the current profile set.
3. Verify every profile has a valid unique username.
4. Deploy RPCs while old clients continue functioning; old clients do not depend on username being null.
5. Deploy repository methods and new People UI.
6. Verify existing invite links, friend requests, friend-of-friend discovery, proof visibility, and League personalization remain unchanged.

No proof/check-in data is rewritten.

## Testing

### Database

- backfill gives every existing profile a valid unique username;
- new profile insertion auto-generates username;
- collision generation remains unique;
- invalid/reserved/manual usernames are rejected;
- `set_my_username` can update self only;
- `search_people` requires authentication;
- queries shorter than 2 characters cannot enumerate users;
- search by exact/prefix username works;
- search by display name works case-insensitively;
- result limit is capped at 20;
- email/phone/private columns are never returned;
- relationship status is correct for available/outgoing/incoming/friend;
- mutual count is correct without exposing identities;
- `suggest_people` returns mutual-based non-friends only;
- existing profile RLS remains restrictive.

### Repository/domain

- generated/search result mappings preserve safe fields only;
- search is latest-query-wins;
- search/suggestion methods do not call full `load()`;
- request/accept operations update row relationship state correctly;
- username save returns normalized value and preserves conflict errors.

### UI

- People icon opens full-height People surface, not a bottom tab;
- incoming-request badge is visible/count-correct;
- empty search shows Requests → Suggestions → Friends;
- search field is sticky and does not autofocus on open;
- 2-character threshold and debounce are honored;
- rows show name, username, mutual count, relationship action;
- Add → Requested and Accept → Friends;
- search/suggestion mutations do not rerender Friends feed underneath;
- Share invite and invite-code fallback remain accessible;
- Profile & app exposes editable username;
- non-friend discovery view does not leak proof/activity/streak data;
- existing friend profile behavior remains unchanged.

### Manual mobile checks

- iPhone Home Screen PWA: open/close People repeatedly and verify Friends scroll is unchanged;
- type search quickly and verify stale results never flash over newer text;
- add/accept between two real test accounts;
- rename username and immediately find it by the new username;
- verify keyboard/safe-area behavior on the full-height People screen;
- verify dark mode and small-screen row layout.

## Out of scope

- email/phone/contact-book discovery;
- importing phone contacts;
- fuzzy/trigram search unless real scale justifies it;
- public follower/following semantics;
- private-account approvals beyond the existing friend-request model;
- user blocking;
- username-change cooldown;
- arbitrary zero-mutual stranger recommendations;
- a new bottom-navigation tab;
- redesigning friend-only profile content.
