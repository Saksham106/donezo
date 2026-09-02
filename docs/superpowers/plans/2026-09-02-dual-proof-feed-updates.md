# Dual Proof Feed Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configured BeReal-style dual-camera proofs, render complete proof images inline, remove the separate proof viewer and Proofs/Activity tabs, and turn the top-right nudge inbox into a unified Updates center with unread state.

**Architecture:** `dual_photo` remains a normal proof-bearing check-in with one final composite JPEG in the existing proof bucket. A focused `src/dual-proof.js` owns capture/composition helpers while `src/app.js` owns sheets/state. Friends becomes proof-only; non-proof friend activity joins incoming nudges in a normalized Updates list backed by a private `user_update_state.last_seen_at` high-water mark and an atomic `mark_updates_seen()` RPC.

**Tech Stack:** Vanilla JS ES modules, browser MediaDevices/Canvas APIs, Supabase Postgres/Auth/Storage/RLS/RPC, existing CSS/PWA shell, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-dual-proof-feed-updates-design.md`

## Global Constraints

- Proof modes are exactly `none`, `photo`, and `dual_photo`.
- Dual-photo check-ins upload exactly one composite proof object and keep using `check_ins.proof_path`.
- Main proof imagery must never be cropped in feed/profile rendering.
- Existing reactions, replies, rejection voting, audience privacy, undo, re-upload, scoring, and single-photo proofs must continue to work.
- Updates visibility must remain identical to the former non-proof Activity feed visibility.
- Opening Updates marks loaded updates seen atomically using server time; update read state is private to the current user.
- No new push-notification category is introduced.
- TDD: every behavior change gets a failing regression/unit test before production code.

---

### Task 1: Database support for dual proof mode and Updates read state

**Files:**
- Create: `supabase/migrations/20260902_dual_photo_updates_state.sql`
- Test: `test/dual-proof-updates-migration.test.mjs`

**Interfaces:**
- Produces: `habits.proof_mode` accepts `dual_photo`; table `public.user_update_state(user_id,last_seen_at)`; RPC `public.mark_updates_seen()` returning `timestamptz`.

- [ ] **Step 1: Write failing migration tests** asserting the migration adds `dual_photo`, enforces proof-required modes, creates self-owned RLS for `user_update_state`, and defines `mark_updates_seen()` that updates incoming nudges and high-water mark from one captured `now()`.
- [ ] **Step 2: Run the targeted test** with `node --test test/dual-proof-updates-migration.test.mjs` and confirm it fails because the migration does not exist.
- [ ] **Step 3: Add the migration**. Drop/recreate the `habits_proof_mode_check` constraint to allow the three modes. Update current check-in insert/update proof-mode enforcement so `none` requires null proof and all other modes require a proof path/object. Create `user_update_state` with `user_id` PK/FK to profiles and `last_seen_at timestamptz not null default '-infinity'::timestamptz`; enable RLS and self-select/upsert only. Define SECURITY DEFINER `mark_updates_seen()` with fixed `search_path`, capture `clock_timestamp()` once, update caller’s unread incoming nudges, upsert caller’s state to `greatest(existing,last timestamp)`, and return the timestamp. Grant execute only to authenticated.
- [ ] **Step 4: Run the targeted test** and confirm PASS.
- [ ] **Step 5: Commit** `feat: add dual proof and updates database support`.

### Task 2: Proof-mode helpers and repository state

**Files:**
- Modify: `src/store.js`
- Modify: `src/domain.js` or create focused helper in `src/proof.js` depending on current proof-mode ownership
- Test: `test/dual-proof-mode.test.mjs`
- Test: `test/supabase-store.test.mjs`

**Interfaces:**
- Produces: `requiresPhotoProof(mode)` returning true for `photo|dual_photo`; normalized state exposes `updatesLastSeenAt`; repository method `markUpdatesSeen()`.

- [ ] **Step 1: Write failing tests** for proof-mode normalization/validation, simple-check-in rejection for `dual_photo`, state mapping of `last_seen_at`, and repository `markUpdatesSeen()` RPC call.
- [ ] **Step 2: Run targeted tests** and confirm failures are only new assertions.
- [ ] **Step 3: Implement minimal helpers/state**. Replace business checks that special-case only `photo` with `requiresPhotoProof`. Extend add/edit habit validation to accept `dual_photo`. Load `user_update_state` for the current user and map it to `updatesLastSeenAt`; expose `markUpdatesSeen()` that calls the RPC and updates local state.
- [ ] **Step 4: Run targeted tests** and confirm PASS.
- [ ] **Step 5: Commit** `feat: support dual proof mode in repository`.

### Task 3: Dual capture and composition module

**Files:**
- Create: `src/dual-proof.js`
- Modify: `src/proof.js` only for shared image helpers if necessary
- Test: `test/dual-proof.test.mjs`

**Interfaces:**
- Produces: `createDualProofState(habitId)`, `transitionDualProof(state, action)`, `stopMediaStream(stream)`, `captureVideoFrame(video, options)`, `composeDualProof(mainFile,selfieFile,options) -> Promise<File>`, and camera capability helpers.

- [ ] **Step 1: Write failing unit tests** for state transitions, preserving one side during retake/error, stream-track cleanup, full main-image aspect preservation, square selfie inset geometry, JPEG output metadata, and size validation path.
- [ ] **Step 2: Run `node --test test/dual-proof.test.mjs`** and confirm RED.
- [ ] **Step 3: Implement the focused module** with dependency-injectable canvas/decode/encode hooks so geometry is deterministic in Node tests. Main image is scaled proportionally to max dimension; selfie uses center square crop into ~30% width top-right inset; output JPEG is converted to a `File` and passed through generic proof compression/validation as needed.
- [ ] **Step 4: Run the targeted test** and confirm PASS.
- [ ] **Step 5: Commit** `feat: add dual proof capture composition`.

### Task 4: Dual-photo habit editor and capture UI

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `social.css` and/or `styles.css`
- Test: `test/dual-proof-ui.test.mjs`
- Update relevant existing habit/proof UI tests.

**Interfaces:**
- Consumes: Task 2 `requiresPhotoProof`; Task 3 dual-proof state/composition helpers.
- Produces: habit editor option `dual_photo`; in-app rear→front camera flow with sequential file-input fallback; review with Retake proof / Retake selfie / Submit / Cancel.

- [ ] **Step 1: Write failing UI/source tests** for the new proof-mode option, dual flow state/sheets, camera track cleanup hooks, fallback inputs with `capture=environment` and `capture=user`, separate retake actions, and submission through existing `completeWithProof` using the composite file.
- [ ] **Step 2: Run targeted UI tests** and confirm RED.
- [ ] **Step 3: Implement UI/state**. Regular `photo` keeps current camera/library/paste sheet. `dual_photo` enters dual capture. Use `getUserMedia` when available; stop rear before requesting front; fall back to capture-oriented file inputs on denied/unavailable/switch failure. Preserve captures during retakes/errors. Review the composite before submission. Ensure all close/cancel/error paths stop media tracks.
- [ ] **Step 4: Run targeted tests** and confirm PASS.
- [ ] **Step 5: Commit** `feat: add dual camera proof flow`.

### Task 5: Full-image feed and proof-viewer removal

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Update: `test/mobile-polish-v2.test.mjs`, `test/friends-ui.test.mjs`, `test/proof-feed-cleanup.test.mjs`

**Interfaces:**
- Produces: inline full proof image rendering using existing signed-URL lazy loading; no standalone proof viewer state/sheet/action.

- [ ] **Step 1: Write failing regressions** asserting proof cards/profile proof history use full-width `img` with `height:auto`/non-cover behavior, no `Open proof`/proof-viewer sheet/state/bindings remain, and signed URLs still lazy-load inline.
- [ ] **Step 2: Run targeted tests** and confirm RED.
- [ ] **Step 3: Replace thumbnail/viewer split** with a single inline proof-media renderer. Keep IntersectionObserver/signed URL caching but render the complete image in-card. Remove proof viewer state, load function, sheet, handlers, and viewer-only CSS. Add inline signed-link/image retry state.
- [ ] **Step 4: Run targeted tests** and confirm PASS.
- [ ] **Step 5: Commit** `feat: show full proofs inline`.

### Task 6: Proof-only Friends feed and unified Updates center

**Files:**
- Modify: `src/app.js`
- Modify: `src/store.js` if normalization helper belongs there
- Modify: `social.css`
- Update: `test/friends-ui.test.mjs`, `test/app-shell.test.mjs`, `test/polish-batch.test.mjs`
- Create: `test/updates-center.test.mjs`

**Interfaces:**
- Consumes: `updatesLastSeenAt`, `markUpdatesSeen()`.
- Produces: Friends proof-only feed; `updatesList(state)` normalized chronological rows; `unseenUpdatesCount(state)`; top-right Updates sheet/badge.

- [ ] **Step 1: Write failing tests** asserting `squadFeed`/`donezo.squadFeed`/Proofs-Activity segmented controls are gone; Friends feed filters to proof activities only; Updates contains every non-proof activity type plus incoming nudges in timestamp-desc order; badge counts unseen non-proof activity + unread nudges; opening calls `markUpdatesSeen()` and optimistically clears badge; nudge privacy/action semantics remain.
- [ ] **Step 2: Run targeted tests** and confirm RED.
- [ ] **Step 3: Implement normalized Updates data**. Keep nudge and activity row shapes distinct but sortable by `when`. Unseen activity is `when > updatesLastSeenAt`; unread nudges use existing `readAt`. Avoid double-counting by treating these as separate normalized items. Rename inbox copy/ARIA to Updates. On open, snapshot loaded items, optimistically set local high-water/read state, then persist via RPC; failed persistence triggers reconciliation/error.
- [ ] **Step 4: Simplify Friends screen** to proof feed only; remove tab state/persistence and old Activity rendering path from main feed while preserving incremental loading.
- [ ] **Step 5: Run targeted tests** and confirm PASS.
- [ ] **Step 6: Commit** `feat: unify friends feed and updates`.

### Task 7: End-to-end regression, migration deployment, and release

**Files:**
- Update any stale tests discovered by full suite only when they encode intentionally replaced behavior.
- No unrelated refactors.

**Interfaces:**
- Produces: green feature branch, applied Supabase migration, merged PR, green production deployment.

- [ ] **Step 1: Run full `npm test`** and fix only genuine regressions/stale expectations caused by the approved design.
- [ ] **Step 2: Run `npm run check`** and confirm success.
- [ ] **Step 3: Run production `npm run build`** with CI-safe Supabase env values and confirm success.
- [ ] **Step 4: Review branch diff** against the spec: no extra proof columns, no cropped feed image, no viewer, no feed tabs, no lost activity type, no new push category, one composite upload.
- [ ] **Step 5: Apply `20260902_dual_photo_updates_state.sql` to the Donezo Supabase project** and verify schema/RPC/RLS with read-back queries.
- [ ] **Step 6: Open PR** against `main`; require standard CI and Vercel preview success.
- [ ] **Step 7: Squash merge**, verify `main` CI, and verify Vercel production success.
