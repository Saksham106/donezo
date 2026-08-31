# Fluid Performance and Invite UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Donezo feel immediate on common mobile interactions, accelerate warm startup, and collapse the Friends invite flow to one direct share action.

**Architecture:** Keep the existing vanilla ES-module + Supabase architecture. Add a small deterministic optimistic coordinator and IndexedDB state cache, expose repository `peekState()`/hydration hooks, patch hot local state before persistence, coalesce reconciliation refreshes, and retain network-first behavior for multi-step or authorization-sensitive writes.

**Tech Stack:** Vanilla JavaScript ES modules, Supabase JS 2.112.4, IndexedDB, Node 24 test runner, CSS, service-worker PWA, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-31-fluid-performance-invite-ux-design.md`

## Global Constraints

- No framework/state-library rewrite.
- No Realtime addition or schema migration in this pass.
- No offline mutation queue; writes fail closed when offline.
- The server/RLS remains authoritative.
- Cached startup data is user-scoped, metadata/state only, schema-versioned, and valid for at most 7 days.
- Positive proof reactions remain one per user/proof; `👎` remains independent.
- Proof uploads, habit/schedule writes, friend relationship writes, and other multi-step mutations stay authoritative/network-first.
- Preserve existing scroll/draft/PWA-update safety.

---

### Task 1: Lock performance contracts with failing tests

**Files:**
- Create: `test/fluid-performance.test.mjs`
- Test: `test/refresh.test.mjs`, `test/pwa.test.mjs`, existing Friends/social tests

**Interfaces:**
- Consumes: current source files and the new modules planned below.
- Produces: deterministic RED tests for cache validation, serialized latest-intent coordination, hot-path no-reload contracts, direct invite sharing, cached proof URLs, and shell-cache bump.

- [ ] Write tests for `createLatestIntentCoordinator()` that prove one writer per key, immediate desired-value changes, latest intent wins, and stale failure cannot roll back newer intent.
- [ ] Write tests for state-cache envelope validation: correct user/schema/fresh age accepted; stale/wrong-user/wrong-schema rejected.
- [ ] Add source-structure assertions that hot reaction/check-in/downvote/reply/nudge methods no longer `return load()` and that app hot handlers do not use the global `runMutation()` path.
- [ ] Assert the Friends list sheet has a single two-column action row and `Invite friends` calls the direct share flow rather than opening `inviteSheetOpen`.
- [ ] Assert proof viewer consults the signed-thumbnail cache before requesting a new signed URL.
- [ ] Assert the PWA cache advances beyond v24 and build/check scripts include new modules.
- [ ] Commit tests and verify CI is RED only for the new behavior.

### Task 2: Add isolated optimistic and warm-cache primitives

**Files:**
- Create: `src/optimistic.js`
- Create: `src/state-cache.js`
- Modify: `package.json`
- Test: `test/fluid-performance.test.mjs`

**Interfaces:**
- Produces: `createLatestIntentCoordinator({ persist, onConfirmed, onError, yieldToPaint })`; `readStateCache(userId, options)`, `writeStateCache(userId, state, options)`, `clearStateCache(userId, options)`, `validateStateCacheEnvelope(envelope, userId, now)`.

- [ ] Implement latest-intent coordinator with one in-flight write per key and a desired/confirmed loop.
- [ ] Ensure failures only roll back when the failed desired value is still current; if newer intent exists, continue toward the newer value.
- [ ] Implement IndexedDB cache through an injected/openable DB boundary so validation is unit-testable without a browser DB.
- [ ] Store `{ schemaVersion, userId, savedAt, state }`; reject entries older than 7 days.
- [ ] Add new modules to `npm run check`.
- [ ] Run targeted tests until GREEN.

### Task 3: Refactor repository state access and hot mutations

**Files:**
- Modify: `src/store.js`
- Test: `test/fluid-performance.test.mjs`, `test/supabase-store.test.mjs`, social tests

**Interfaces:**
- Produces: `peekState()`, `hydrateState(cachedState)`, local patch helpers, and persistence methods that do not full-reload on hot writes.

- [ ] Keep `getState()` as a defensive clone and add `peekState()` returning the current state reference by contract.
- [ ] Add `hydrateState(cachedState)` that validates the current user ID before replacing in-memory state.
- [ ] Centralize derived-state rebuilding after local reaction/check-in/comment/nudge changes so activity counts, invalid flags, streak/progress data stay coherent.
- [ ] Refactor positive reaction persistence to delete/insert without `load()`; the app coordinator owns optimistic desired state and reconciliation scheduling.
- [ ] Refactor no-proof check-in toggle, proof rejection, add/delete comment, and nudge-read persistence to return affected server rows/results without synchronous full `load()`.
- [ ] Avoid `loadFriends()` inside `setHabitAudience` when current friendship state is already loaded; use loaded friendships for normalization and keep final authoritative reload for the slow habit operation.
- [ ] Narrow hot/large `select('*')` queries where mapper requirements are known, without changing history limits.
- [ ] Run store/social tests.

### Task 4: Integrate optimistic UI, reconciliation, and warm startup

**Files:**
- Modify: `src/app.js`
- Modify: `src/refresh.js` only if a small scheduling hook is required
- Test: `test/fluid-performance.test.mjs`, app/refresh/mobile tests

**Interfaces:**
- Consumes: repository `peekState()/hydrateState()`, optimistic coordinator, state-cache functions.
- Produces: app-level hot mutation lane and coalesced reconciliation.

- [ ] Change app `getState` hot read to prefer `repo.peekState()` and capture one repository state at the top of `render()`; pass snapshots into helpers where practical.
- [ ] Add a coalesced deferred reconciliation request so bursts of successful hot writes produce one later authoritative refresh.
- [ ] Implement reaction UI optimistic patch before persistence, immediate haptic feedback, serialized latest-intent persistence, rollback/error only for final failed intent, and no global Saving indicator.
- [ ] Apply optimistic local patches to no-proof check-in, confirmed rejection vote, reply add/delete, and nudge read; keep proof upload/network-heavy flows unchanged.
- [ ] Ensure incoming authoritative refresh data cannot erase currently pending optimistic intent: reapply pending local patches after a refresh until confirmed.
- [ ] On boot, create repository, read valid user cache, hydrate/render cached state immediately, then start authoritative load. After successful load, schedule cache write during idle time.
- [ ] If authoritative load fails after cached state rendered, keep cached UI and fail writes closed instead of replacing it with the blocking load-error screen.
- [ ] Clear the active user's cached state on sign-out.
- [ ] Reuse cached signed proof-thumbnail URLs in the proof viewer when present.
- [ ] Run targeted app/refresh tests.

### Task 5: Simplify Friends invite UX and reduce tiny rerenders

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Test: `test/fluid-performance.test.mjs`, Friends tests

**Interfaces:**
- Produces: one `.people-growth-actions` row with direct share behavior.

- [ ] Render `Invite friends` and `Add by link` in one two-column row at normal phone widths.
- [ ] Change `[data-invite-from-people]` to call direct invite creation + native share/copy without toggling `inviteSheetOpen` or assigning `createdFriendInvite` in a way that triggers `creatorInviteScreen()`.
- [ ] Keep onboarding/new-workspace success sharing intact when genuinely contextual.
- [ ] Keep `Add by link` opening the existing add-friend sheet directly.
- [ ] Avoid whole-app rerenders for reaction-only visual state where targeted DOM patching is safe; otherwise use scroll-preserving render without global busy state.
- [ ] Run Friends/performance tests.

### Task 6: Release verification and rollout

**Files:**
- Modify: `sw.js`
- Modify tests that pin the previous shell version.

- [ ] Bump PWA shell cache from v24 to v25 and update existing version assertions.
- [ ] Run `npm test`, `npm run check`, and CI-safe `npm run build`.
- [ ] Review branch diff for accidental `load()` calls left in hot mutation success paths, unrelated refactors, or weakened authorization.
- [ ] Open a PR against `main`; verify PR CI.
- [ ] Deploy a Vercel preview and verify warm launch, rapid reaction switching, no-proof check-in, proof rejection, reply add/delete, nudge-read count, proof viewer, Friends direct share, Add by link, scroll/draft safety.
- [ ] Merge only after checks pass, then verify main CI and production deployment serves v25.
