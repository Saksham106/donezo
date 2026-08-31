# Fluid Performance and Invite UX Design

## Goal

Make Donezo feel immediate and fluid across everyday interactions without rewriting the app or weakening correctness. User-visible changes should normally paint on the next frame while network persistence and authoritative reconciliation happen afterward. Also simplify the Friends invite flow to one compact row and a single share action.

## Why this pass is architectural

Donezo currently couples many small mutations to full repository reloads and full-app rerenders. A reaction, for example, performs the database write and then calls the same large `load()` path used for boot/background refresh. That load performs multiple dependent query waves before the UI reflects the result. Separately, `getState()` deep-clones the entire state object and `render()` replaces the app shell through `innerHTML`, so small local interactions can cause unnecessary CPU, DOM, event-binding, image, and layout work.

Cold/warm app startup also waits for the entire authoritative network load before showing any real app data. This pass changes the shared mutation/state/rendering contract and adds a read-only last-good warm-start cache so the app can paint useful state before network reconciliation.

This pass intentionally stays inside the existing vanilla-JS + Supabase architecture.

## Performance targets and principles

- A user tap that has an obvious local result should visually respond in the next paint whenever safe.
- Target good mobile interaction responsiveness: user-visible feedback should normally occur well below the 200 ms INP threshold.
- Network persistence must not block the first visible response for optimistic-safe mutations.
- Avoid whole-app reloads after mutations whose affected rows are known locally.
- Avoid unnecessary deep clones and full DOM rebuilds on small state changes.
- Background refresh must never overwrite newer optimistic intent.
- Warm app startup should render the last good user-specific state before the authoritative network load completes when a valid cache exists.
- Server state remains authoritative; optimistic failures must roll back the affected local change and surface a concise error.
- Do not add a framework rewrite, new state-management dependency, service worker mutation queue, giant bootstrap SECURITY DEFINER RPC, or broad offline-write subsystem in this pass.

These principles follow current web performance guidance: paint the critical user-visible result first, defer non-critical remote saving until after that frame, keep interaction work small, and avoid large rendering updates. Supabase Realtime Broadcast is useful for remote-user propagation, but is not required to make the initiating user’s own tap immediate.

## 1. State access: stop cloning on every read

`createSupabaseRepository` currently keeps one mutable internal `state` object and exposes `getState()` by `structuredClone(state)`. Rendering calls `getState()` many times, so one render can clone the same large state repeatedly.

Add two explicit read paths:

- `getState()` remains the safe cloned snapshot for tests/external callers that may rely on isolation.
- `peekState()` returns the current read-only-by-contract in-memory state reference for the app renderer and hot UI paths.

`src/app.js` should use a single state snapshot per render and helpers should accept/pass that state where practical instead of repeatedly calling the repository. The app must not mutate `peekState()` directly except through repository-owned state patch methods described below.

This is a targeted performance boundary, not a general store rewrite.

## 2. Read-only warm-start cache

Add a small `src/state-cache.js` module using IndexedDB, keyed by authenticated user ID and a cache schema version.

Behavior:

1. After a successful authoritative repository load, write the derived last-good state plus `savedAt` to IndexedDB during idle/non-critical time.
2. On boot after the Supabase session is known, read only that user’s cache.
3. If the cache schema matches and it is no more than 7 days old, hydrate the repository and render it immediately as stale-but-usable state.
4. Start the authoritative network load immediately afterward.
5. When the network load completes, replace/reconcile the cached snapshot and update the cache.
6. If network load fails but a cached snapshot was rendered, keep the app usable in read-only/fail-closed mutation behavior and show the existing offline/error status instead of replacing the whole app with a blocking failure screen.
7. Clear the active user’s cache on sign-out.

The cache stores metadata/state only, never proof image blobs, auth tokens, passwords, or private storage file bytes. It is a perceived-startup optimization, not an offline mutation queue.

## 3. Reduce authoritative load waterfall

Keep RLS and current table ownership as the security boundary. Do not create a large SECURITY DEFINER bootstrap RPC solely for speed.

Refactor `load()` so independent reads start as early and concurrently as correctness permits, and narrow `select('*')` calls on hot/large tables to the columns the mapper actually consumes where practical.

Targets:

- preserve the initial profile/membership/friendship/request dependency needed to identify visible people and active circle;
- collapse later independent circle/social reads into the fewest dependency waves practical;
- avoid reloading friend/profile data again inside a mutation when current loaded state is already sufficient for validation;
- keep current limits/history semantics unless a test proves a smaller scope is safe.

This optimization improves uncached first load and reconciliation latency, while the warm-start cache hides most network wait on subsequent launches.

## 4. Repository-local state patching

Introduce small repository patch helpers that update the in-memory state and rebuild only the derived fields needed for the changed entity instead of calling full `load()`.

The repository should provide focused optimistic-safe operations for the high-frequency interaction set:

- positive proof reaction
- proof rejection/downvote after confirmation
- simple no-proof check-in toggle
- add reply
- delete reply
- mark nudge read

Each operation follows the same contract:

1. Validate against current state.
2. Create an optimistic local state patch synchronously.
3. Expose the patched state to the UI immediately.
4. Persist the write asynchronously.
5. On success, normalize local temporary IDs/timestamps where necessary and schedule a low-priority reconciliation refresh.
6. On failure, roll back only that operation’s patch and report the error.

More complex writes—habit editing, schedule changes, proof uploads, friend relationship changes, challenge/stake creation, account/settings changes—remain authoritative/network-first for this pass because they span multiple tables, files, or authorization-sensitive workflows.

## 5. Optimistic mutation coordinator

Create a small app-level optimistic mutation coordinator rather than overloading the existing global `runMutation()` path.

Required behavior:

- It must not set the global `busy` flag for independent lightweight interactions.
- It must not wait for `refreshCoordinator.waitForIdle()` before painting local feedback.
- It renders/patches the local UI first, then yields at least one frame before starting non-critical persistence when practical.
- It tracks pending operations by a stable mutation key such as `reaction:<checkInId>` or `comment:<checkInId>`.
- It provides per-operation rollback and error feedback rather than freezing unrelated controls.
- It avoids duplicate submits for operations that cannot safely overlap.
- It exposes pending intent to the refresh reconciliation layer so incoming server snapshots cannot erase newer local intent.

For coalescible operations such as reactions, persistence is **serialized per mutation key**. There is at most one server write in flight for `reaction:<checkInId>`. New taps update the UI/desired value immediately while that request is running; when it completes, the worker persists only the latest desired value if it differs from what was confirmed. This prevents an older network response from winning after a newer selection.

The existing `runMutation()` remains for slower authoritative operations.

## 6. Reactions: immediate, serialized, latest-intent wins

Reaction taps are the primary example of the new flow.

When the user taps a reaction:

- Update the current proof card immediately: active emoji, counts, summary, and haptic feedback.
- Do not display the global `Saving…` indicator for every reaction switch.
- Set the desired positive reaction for that proof (`emoji` or no reaction).
- Use one serialized persistence worker per proof; rapid `🔥 → 👏 → 😂` changes the UI immediately each time but never runs competing writes that can finish out of order.
- Persist the latest selected positive reaction using the existing one-positive-reaction database invariant.
- Avoid a full repository `load()` after each successful write.
- If an in-flight stale request fails while a newer desired reaction exists, do not roll back the newer UI; continue/retry reconciliation toward the latest desired value according to the coordinator contract.
- If persistence of the latest desired value fails with no newer intent, restore the last server-confirmed reaction state for that proof and show a concise failure toast.

The independent `👎` proof-rejection signal continues to be separate.

## 7. Simple check-ins, replies, rejection, and read state

Apply the same pattern where correctness is local and rollback is straightforward.

### No-proof check-in toggle

Optimistically add/remove today’s local check-in and immediately update Today progress. Persist the insert/delete afterward. On failure restore the prior local state.

Proof uploads stay network-first because image compression/upload and check-in creation are a multi-step transaction with cleanup concerns.

### Proof rejection/downvote

After the existing confirmation step, update the local rejection vote immediately and recompute the affected proof’s vote count/invalid state from existing audience data. Persist afterward. On failure restore the prior local vote/proof state.

### Replies

When posting a reply, add a temporary local reply immediately with the current user, body, and temporary ID/timestamp. On success replace it with the server row. On failure remove it and preserve the typed text or expose a retry path.

Deleting your own reply removes it immediately and restores it on failure.

### Nudge read state

Mark read locally immediately; persist in the background. Failure may quietly reconcile on the next refresh unless it affects visible unread count correctness, in which case restore it and show a small error.

## 8. Reconciliation and refresh behavior

Full `load()` remains the source of truth for boot, manual refresh, reconnect, focus/visibility refresh, and periodic background refresh.

Change refresh interaction rules:

- Lightweight optimistic mutations must not wait behind an unrelated background refresh before painting.
- A full refresh should not commit over newer optimistic state. Pending optimistic operation keys must be reapplied or the incoming snapshot must be merged with pending local intent before becoming visible.
- After optimistic persistence succeeds, schedule one coalesced reconciliation refresh rather than one full reload per mutation.
- Several hot writes in a short window should produce at most one deferred full reconciliation.
- Manual refresh remains explicit and authoritative, but pending local intent still cannot be silently overwritten.

Keep the existing 30-second coordinator unless measurement proves the interval itself is a problem; the main issue is mutation coupling to the refresh/load path, not the interval timer.

## 9. Rendering improvements without a framework rewrite

The current renderer rebuilds the whole app shell with `app.innerHTML` and rebinds all handlers on each render. Do not attempt a full component framework migration in this pass.

Use focused improvements:

- Use one state snapshot per render.
- Avoid full renders for tiny visual changes that can be patched safely in place, especially reaction buttons/counts and mutation-status UI.
- Preserve the current DOM when only a hot proof-card reaction changes.
- Avoid rerendering simply to show `Saving…` for optimistic operations.
- Keep proof thumbnail signed URLs cached and reuse an existing valid signed URL for the full proof viewer when available; do not make a redundant signing request solely because the user opens a proof that already has a live cached URL.
- Keep existing lazy thumbnail loading via `IntersectionObserver`.
- Preserve scroll/draft safeguards.

Do not split `src/app.js` solely for style. A small focused `src/optimistic.js` or similar helper is acceptable if it meaningfully isolates the mutation-coordination logic and is unit-testable.

## 10. Instrumentation and regression targets

Add lightweight development/test instrumentation rather than a production analytics dependency.

Tests should enforce structural performance contracts:

- a valid warm cache renders before authoritative network completion;
- stale/wrong-user cache is ignored and sign-out clears the active user cache;
- reaction handling paints local state before awaiting persistence;
- reaction persistence is serialized per proof and latest intent wins;
- reaction persistence does not call full `load()` on each success;
- optimistic rollback restores prior state on final persistence failure;
- hot mutations do not wait for background refresh before local feedback;
- reconciliation does not overwrite pending optimistic intent;
- no-proof check-in, proof rejection, reply add/delete, and nudge-read hot paths patch local state without a synchronous full reload;
- app render path does not repeatedly deep-clone state through `getState()`;
- proof viewer reuses cached signed URLs when available;
- authoritative load still respects RLS-visible datasets and existing history limits;
- existing draft/scroll/background-refresh safety tests remain green.

Where practical, use deterministic unit tests around the cache and optimistic coordinator rather than fragile wall-clock timing tests.

## 11. Friends list action layout

The Friends child/list sheet footer becomes a single two-column row:

- left: `Invite friends`
- right: `Add by link`

On very narrow screens it may stack only if necessary to avoid unusably small tap targets; standard phone widths should remain one row.

## 12. Invite flow simplification

Tapping `Invite friends` from the Friends list should not open an intermediate Donezo invite sheet.

New flow:

1. Tap `Invite friends`.
2. Create a fresh single-use friend invite in the background.
3. Open the native Web Share sheet immediately once the fresh invite exists.
4. If `navigator.share` is unavailable, copy the fresh invite URL and show `Invite link copied`.
5. If invite creation fails, stay on the Friends list and show the error.

Remove the redundant in-app Friends invite layers used for this normal flow:

- no intermediate sheet whose only purpose is to expose another `Share invite` button;
- no second creator-success screen caused merely by generating a friend invite from inside the app.

The onboarding/new-workspace success flow may still offer a one-time share action when it is genuinely contextual, but generating a fresh friend invite must not hijack the entire app into `creatorInviteScreen()`.

`Add by link` continues to open the existing join/add-by-link sheet directly.

## 13. Error handling and concurrency

- Optimistic operations store the last server-confirmed local value needed for rollback.
- A failed stale reaction request must never roll back a newer reaction selection.
- Network errors should not disable unrelated buttons globally.
- Authoritative operations continue to use global busy protection where double-submit would be harmful.
- Offline optimistic writes are not queued across sessions in this pass. If offline at interaction time, either keep existing fail-closed behavior or show a local transient state only if the operation has an explicit retry/rollback contract. No service-worker background mutation queue is added.
- Cached startup state never grants authorization; all writes still go through existing RLS/RPC authorization and fail closed if the server rejects them.

## 14. Supabase and database scope

No schema change is expected for this pass. The positive reaction uniqueness constraint added in migration 0025 remains authoritative.

Do not add Realtime yet. Current Supabase guidance recommends Broadcast for scalable low-latency database fan-out, and it may be a future enhancement for making other users’ actions arrive instantly. This pass first removes unnecessary reload/waterfall latency for the initiating user, which is the higher-ROI fix.

## 15. Verification and rollout

Required verification:

- regression tests written before implementation;
- `npm test` passes;
- `npm run check` passes;
- `npm run build` passes;
- PR CI passes;
- review final diff for accidental full reloads remaining in hot mutation paths;
- deploy preview and verify warm startup, reaction switching, no-proof check-in, proof rejection, reply posting/deleting, Friends invite share flow, add-by-link flow, scroll/draft preservation, and proof viewing;
- simulate persistence failures in tests and confirm rollback/latest-intent rules;
- merge only after preview/CI checks;
- deploy production and verify the live service worker/app bundle reflects the new release.

## Success criteria

The pass is successful when everyday taps feel immediate even on ordinary mobile network latency: warm launches show useful state without staring at a blocking loader, reaction switching changes visually right away, lightweight check-ins/replies/rejection/read-state no longer wait for full reloads, unrelated controls do not freeze during small writes, and inviting a friend is a one-tap path from the Friends list into the native share sheet.