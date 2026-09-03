# Proof and Friends UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make proof capture native-first and compact, crop only unusually tall proofs before upload, make friend relationships reversible directly from People, and tighten Friends proof cards without losing exact clock time.

**Architecture:** Remove the live `getUserMedia()` camera surface and keep native file inputs as the capture boundary. Introduce one small shared image decoder plus a pure crop module, so crop happens locally before the existing single-upload/composition pipeline. Friend cancellation is a new authenticated RPC exposed through the existing repository adapters; People remains an overlay-local state machine. Proof-card changes stay presentation-only.

**Tech Stack:** Vanilla ES modules, DOM/CSS, Canvas API, Supabase/Postgres RPCs, Node test runner, Vercel PWA.

**Spec:** `docs/superpowers/specs/2026-09-02-proof-friends-polish-design.md`

## Global Constraints

- Native iPhone/file-input capture is the normal proof flow; no visible Donezo live-camera option.
- The normal review row is exactly **Choose another** + emphasized **Make Dual**.
- Dual supports first-photo-as-Main and first-photo-as-Selfie.
- Proofs need manual crop only when oriented height exceeds `width * 4 / 3`; crop viewport is 3:4.
- Only the final cropped/composited proof artifact is uploaded; uncropped inputs never become extra storage objects.
- Outgoing **Requested** is tappable to cancel; **Friends** is tappable to confirm removal.
- Friends proof-card identity is display name only; keep relative time and exact clock time; remove username and streak.
- Existing reactions/replies/audience authorization and 4 MB proof ceiling remain intact.
- No third-party crop dependency.
- A Vercel Hobby build-rate failure is deployment-incomplete evidence, not a reason to weaken code verification.

---

### Task 1: Shared proof image codec and deterministic 3:4 crop module

**Files:**
- Create: `src/proof-image.js`
- Create: `src/proof-crop.js`
- Modify: `src/proof.js`
- Modify: `src/dual-proof.js`
- Create: `test/proof-crop.test.mjs`
- Modify: existing proof/dual tests only where imports intentionally move

**Interfaces:**
- Produces `decodeProofImage(file): Promise<ImageBitmap|HTMLImageElement>`.
- Produces `proofImageSize(image): { width:number, height:number }`.
- Produces `needsProofCrop(width, height, ratio = 3/4): boolean`.
- Produces `cropGeometry(width, height, position, ratio = 3/4): { sourceX, sourceY, sourceWidth, sourceHeight, outputWidth, outputHeight }` where `position` is normalized `0..1` vertical placement.
- Produces `cropProofFile(file, position, options?): Promise<File>` returning JPEG.
- `compressProofFile` and `composeDualProof` consume the shared decoder instead of maintaining duplicate Safari fallbacks.

- [ ] **Step 1: Write RED crop threshold/math tests**

Create `test/proof-crop.test.mjs` with cases equivalent to:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsProofCrop, cropGeometry } from '../src/proof-crop.js';

test('crop is required only beyond 3:4 portrait height', () => {
  assert.equal(needsProofCrop(1200, 1600), false);
  assert.equal(needsProofCrop(1200, 1599), false);
  assert.equal(needsProofCrop(1200, 2000), true);
  assert.equal(needsProofCrop(1600, 1200), false);
});

test('crop geometry clamps top middle and bottom positions', () => {
  assert.deepEqual(cropGeometry(1200, 2400, 0), {
    sourceX: 0, sourceY: 0, sourceWidth: 1200, sourceHeight: 1600,
    outputWidth: 1200, outputHeight: 1600,
  });
  assert.equal(cropGeometry(1200, 2400, .5).sourceY, 400);
  assert.equal(cropGeometry(1200, 2400, 1).sourceY, 800);
  assert.equal(cropGeometry(1200, 2400, 9).sourceY, 800);
  assert.equal(cropGeometry(1200, 2400, -2).sourceY, 0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/proof-crop.test.mjs`

Expected: FAIL because `src/proof-crop.js` does not exist.

- [ ] **Step 3: Extract one Safari-safe decoder**

Create `src/proof-image.js` from the existing decode behavior in `src/proof.js`/`src/dual-proof.js`:

```js
export async function decodeProofImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') {
    throw new Error('This browser could not read that photo. Choose a smaller photo or a screenshot.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This browser could not read that photo. Choose a smaller photo or a screenshot.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function proofImageSize(image) {
  const width = Number(image?.width || image?.naturalWidth || 0);
  const height = Number(image?.height || image?.naturalHeight || 0);
  if (!width || !height) throw new Error('This browser could not read that photo.');
  return { width, height };
}
```

Replace private decoder copies in `proof.js` and `dual-proof.js` with this import.

- [ ] **Step 4: Implement pure crop math**

Create `src/proof-crop.js`:

```js
import { decodeProofImage, proofImageSize } from './proof-image.js';

export const PROOF_CROP_RATIO = 3 / 4;

export function needsProofCrop(width, height, ratio = PROOF_CROP_RATIO) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  return w > 0 && h > 0 && h > w / ratio;
}

export function cropGeometry(width, height, position = .5, ratio = PROOF_CROP_RATIO) {
  const w = Math.max(1, Math.round(Number(width)));
  const h = Math.max(1, Math.round(Number(height)));
  const cropHeight = Math.min(h, Math.round(w / ratio));
  const maxY = Math.max(0, h - cropHeight);
  const p = Math.max(0, Math.min(1, Number(position) || 0));
  const sourceY = Math.round(maxY * p);
  return { sourceX: 0, sourceY, sourceWidth: w, sourceHeight: cropHeight, outputWidth: w, outputHeight: cropHeight };
}
```

- [ ] **Step 5: Write RED JPEG-output test with injected codec**

Add a test that injects a fake decoded image and fake encoder, verifies the selected source rectangle, and verifies the returned file is `image/jpeg` with a `-cropped.jpg` name. The implementation must accept injected `decodeImage`/`encodeCrop` options so Node tests do not require a browser canvas.

- [ ] **Step 6: Implement `cropProofFile`**

Use `decodeProofImage`, `cropGeometry`, and a canvas encoder. Preserve `lastModified`; output JPEG quality around `0.9`; always close `ImageBitmap` in `finally`. Do not upload here.

- [ ] **Step 7: Run Task 1 tests + existing proof/dual tests**

Run:

```bash
node --test test/proof-crop.test.mjs test/proof.test.mjs test/dual-proof.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Commit message: `feat: add proof crop primitives`

---

### Task 2: Remove live Donezo camera and make native Dual order-independent

**Files:**
- Modify: `src/app.js`
- Modify: `src/dual-proof.js`
- Modify: `index.html`
- Modify: `social.css`
- Create: `test/native-proof-flow-v2.test.mjs`
- Update: `test/native-camera-upload-replies.test.mjs`, `test/photo-camera-friends-polish.test.mjs`, `test/camera-friends-stability.test.mjs`, `test/dual-updates-polish.test.mjs`, and other legacy camera assertions only where behavior is intentionally replaced

**Interfaces:**
- `proofSourceSheet()` renders only Take photo / Choose from library / Paste.
- `proofReviewSheet()` renders compact Choose another / Make Dual for a single proof.
- New state `dualRoleChoiceOpen` (or equivalently named state) gates the first-photo role sheet.
- `createDualProofState(habitId, options)` stores `mainFile`, `selfieFile`, and capture order without requiring a live-camera phase.
- Native input mapping remains: environment input for Main, user-facing input for Selfie.

- [ ] **Step 1: Write RED source/review contracts**

Assert:

```js
assert.match(sourceSheet, />Take photo</);
assert.match(sourceSheet, />Choose from library</);
assert.match(sourceSheet, />Paste copied photo</);
assert.doesNotMatch(sourceSheet, /Use Donezo camera|data-proof-donezo-camera/);
assert.doesNotMatch(app, /navigator\.mediaDevices\.getUserMedia|data-dual-camera|camera-mode-switch/);

assert.match(reviewSheet, />Choose another</);
assert.match(reviewSheet, />Make Dual</);
assert.doesNotMatch(reviewSheet, />Retake</);
```

Also assert Make Dual and Choose another share one `.proof-review-actions` row and Make Dual has a dedicated accent class.

- [ ] **Step 2: Run the new flow test and verify RED**

Run: `node --test test/native-proof-flow-v2.test.mjs`

Expected: FAIL on current Donezo-camera markup and Retake controls.

- [ ] **Step 3: Simplify the source and single review sheets**

In `proofSourceSheet()`, delete the Donezo camera button. In `proofReviewSheet()`, replace redundant Retake/Choose rows with:

```html
<div class="proof-review-actions compact-proof-review-actions">
  <button class="btn" type="button" data-proof-choose>Choose another</button>
  <button class="btn proof-make-dual" type="button" data-proof-make-dual>Make Dual</button>
</div>
```

Keep Submit proof below this row.

- [ ] **Step 4: Delete dead live-camera UI/lifecycle code**

Remove from `src/app.js` the live-camera stream/request state, `startDualCameraIfNeeded`, `captureDualCamera`, `dualProofSheet`, native fallback-from-live-camera bindings, camera-mode bindings, and visibility-change restart. Remove now-unused `captureVideoFrame`, `dualCameraSupported`, and `stopMediaStream` imports/exports if no remaining tests or code consume them.

Delete corresponding live-camera CSS rather than leaving hidden selectors.

- [ ] **Step 5: Write RED order/cancellation tests**

Test pure state behavior for:

```js
const mainFirst = createDualProofState('habit');
// assign first local file as main, request selfie, then complete with selfie

const selfieFirst = createDualProofState('habit');
// assign first local file as selfie, request main, then complete with main
```

In app-source tests, assert `Make Dual` opens role choices **Main proof** and **Selfie**, and role selection clicks the opposite native input. Assert cancellation of the second picker does not clear `proofReview`.

- [ ] **Step 6: Implement role-choice state and native second capture**

The role-choice handler must preserve photo #1:

```js
if (firstRole === 'main') {
  dualProof = { habitId, mainFile: proofReview.file, selfieFile: null, firstRole: 'main' };
  proofSelfieInput.click();
} else {
  dualProof = { habitId, mainFile: null, selfieFile: proofReview.file, firstRole: 'selfie' };
  dualProofMainInput.click();
}
```

Do not clear `proofReview` until a valid second file is actually selected. If the native picker returns no file, leave the single review untouched.

- [ ] **Step 7: Compose once both roles exist**

When the missing role file is selected, call `composeDualProof(mainFile, selfieFile)` and replace the review file/preview with the composite while retaining `dualProof.mainFile`/`selfieFile` for compact Replace main / Replace selfie actions.

- [ ] **Step 8: Run Task 2 focused tests**

Run:

```bash
node --test test/native-proof-flow-v2.test.mjs test/native-camera-upload-replies.test.mjs test/dual-proof.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Commit message: `feat: simplify native proof capture`

---

### Task 3: Gate submit through conditional crop before storage/composition

**Files:**
- Modify: `src/app.js`
- Modify: `src/proof-crop.js`
- Modify: `social.css`
- Create: `test/proof-crop-ui.test.mjs`
- Update: proof upload/review tests that intentionally change submit sequencing

**Interfaces:**
- New local crop state stores `{ habitId, sourceFile, position, mode, mainFile?, selfieFile? }`.
- `inspectProofFile(file)` (or equivalent helper) decodes only dimensions and returns crop requirement.
- `finalizeProofArtifact()` returns the one File passed to `repo.completeWithProof`.
- Crop sheet never calls repository/storage methods directly.

- [ ] **Step 1: Write RED crop-sheet contracts**

Assert the app contains a crop sheet with:

- a fixed 3:4 viewport;
- pointer/touch drag handling that updates normalized vertical `position`;
- **Use crop** and **Cancel**;
- no repository/storage upload call inside the crop sheet handler.

Assert normal 3:4-or-shorter images bypass crop.

- [ ] **Step 2: Run crop UI tests and verify RED**

Run: `node --test test/proof-crop-ui.test.mjs`

Expected: FAIL because crop state/sheet is absent.

- [ ] **Step 3: Add dimension inspection without upload**

Use the shared decoder to inspect the selected main proof. Keep the decoded object only long enough to read width/height, then close it.

- [ ] **Step 4: Add crop state/sheet and clamped vertical dragging**

Render the source image behind a 3:4 overflow-hidden frame. Convert drag displacement into normalized position using available overflow height; clamp `0..1`. Keep Cancel local and restore review.

- [ ] **Step 5: Wire single submit sequencing**

For a single proof:

```text
Submit -> inspect dimensions
  -> no crop needed: existing compress/validate/upload path
  -> crop needed: open crop sheet
Use crop -> cropProofFile -> compressProofFile -> validate -> upload exactly that file
```

No original storage upload occurs before crop confirmation.

- [ ] **Step 6: Wire Dual sequencing**

For Dual, inspect `dualProof.mainFile`, not the already composed preview:

```text
Submit -> inspect main
  -> no crop: composeDualProof(main, selfie) -> upload composite
  -> crop needed: crop main -> composeDualProof(croppedMain, selfie) -> upload composite
```

The selfie remains the existing centered square inset. Upload exactly one composite JPEG.

- [ ] **Step 7: Add cancellation/error regressions**

Verify:

- Cancel crop returns to review and upload spy count remains `0`.
- Crop decode/encode error leaves original local file available.
- Upload failure after crop retains the final cropped/composite file for retry, preserving current retry semantics.

- [ ] **Step 8: Run Task 3 + full proof suite**

Run:

```bash
node --test test/proof-crop.test.mjs test/proof-crop-ui.test.mjs test/proof.test.mjs test/dual-proof.test.mjs test/native-proof-flow-v2.test.mjs
npm test
npm run check
npm run build
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 3**

Commit message: `feat: crop tall proofs before upload`

---

### Task 4: Add server-authoritative outgoing friend-request cancellation

**Files:**
- Create: `supabase/migrations/20260902_cancel_friend_request.sql`
- Modify: `src/store.js`
- Create: `test/friend-request-cancel.test.mjs`

**Interfaces:**
- SQL RPC: `public.cancel_friend_request(target_request_id uuid) returns public.friend_requests`.
- Production repository: `cancelFriendRequest(requestId): Promise<FriendRequest>`.
- Memory repository: same semantic method; sets `status: 'cancelled'`, `respondedAt`/`responded_at` timestamp.

- [ ] **Step 1: Write RED migration/repository contracts**

Tests must assert SQL contains the equivalent authorization:

```sql
where request.id = target_request_id
  and request.requester_id = actor
  and request.status = 'pending'
for update;
```

and then updates only that row to `cancelled`, sets `responded_at = now()`, revokes public/anon execution, grants authenticated execution.

Repository test asserts `client.rpc('cancel_friend_request', { target_request_id: requestId })` and memory behavior rejects someone else's or terminal request.

- [ ] **Step 2: Run RED**

Run: `node --test test/friend-request-cancel.test.mjs`

Expected: FAIL because migration/method do not exist.

- [ ] **Step 3: Implement migration**

Use this shape:

```sql
create or replace function public.cancel_friend_request(target_request_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.friend_requests;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into target
  from public.friend_requests request
  where request.id = target_request_id
    and request.requester_id = actor
    and request.status = 'pending'
  for update;
  if target.id is null then raise exception 'Friend request is not open'; end if;
  update public.friend_requests request
  set status = 'cancelled', responded_at = now()
  where request.id = target.id
  returning * into target;
  return target;
end;
$$;

revoke all on function public.cancel_friend_request(uuid) from public, anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
```

- [ ] **Step 4: Implement production + memory adapters**

Production uses RPC and then `await load(state.circleId)` only if the existing friend-request state requires authoritative refresh; avoid a load if a safe local state patch is already established by repository conventions. Memory adapter must mirror authorization and terminal-state semantics.

- [ ] **Step 5: Run Task 4 tests + friend repository tests**

Run:

```bash
node --test test/friend-request-cancel.test.mjs test/friends-audiences.test.mjs test/searchable-people.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Commit message: `feat: cancel outgoing friend requests`

---

### Task 5: Make People relationship buttons reversible in place

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Create: `test/people-relationship-controls.test.mjs`
- Update: `test/searchable-people.test.mjs` where Requested/Friends were previously disabled states

**Interfaces:**
- `peopleRelationshipAction(person)` renders clickable `Requested` and `Friends` controls.
- `handlePeopleCancel(requestId, userId)` performs optimistic outgoing cancellation.
- `friendRemovalPerson` (or equivalently named state) drives the small Remove friend confirmation sheet.
- Existing `repo.removeFriend(userId)` remains the persistence method.

- [ ] **Step 1: Write RED relationship-button tests**

Assert:

```js
assert.match(peopleRelationshipActionSource, /data-people-cancel/);
assert.doesNotMatch(requestedBranch, /disabled/);
assert.match(peopleRelationshipActionSource, /data-people-remove/);
assert.doesNotMatch(friendBranch, /disabled/);
```

Assert People has a confirmation sheet containing **Remove friend** and the existing historical-proof visibility explanation can remain concise.

- [ ] **Step 2: Run RED**

Run: `node --test test/people-relationship-controls.test.mjs`

Expected: FAIL because Requested/Friends are disabled today.

- [ ] **Step 3: Implement optimistic Requested -> Add cancellation**

Use current `syncPeopleRelationship` patterns:

```js
async function handlePeopleCancel(requestId, userId) {
  const previousSearch = peopleSearchResults;
  const previousSuggestions = peopleSuggestions;
  syncPeopleRelationship(userId, 'available', null);
  refreshPeopleSheet();
  try {
    await repo.cancelFriendRequest(requestId);
    notify('Friend request unsent.');
  } catch (error) {
    peopleSearchResults = previousSearch;
    peopleSuggestions = previousSuggestions;
    notify(readableError(error), 3600);
  }
  refreshPeopleSheet();
}
```

Ensure relationship patching can explicitly clear `requestId` rather than `null` falling back to the old request ID.

- [ ] **Step 4: Implement Friends -> Remove confirmation**

Tapping Friends sets the confirmation state and refreshes only the People overlay. Confirm calls `repo.removeFriend(userId)`, then refreshes repository/People state and closes the confirmation. Cancel closes only the confirmation. Do not navigate to the person's profile.

- [ ] **Step 5: Add failure and overlay-stability tests**

Verify cancel failure restores Requested; remove failure leaves Friends; neither path calls global `render()` solely to update People.

- [ ] **Step 6: Run Task 5 tests**

Run:

```bash
node --test test/people-relationship-controls.test.mjs test/searchable-people.test.mjs test/fluid-performance.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Commit message: `feat: make friend states reversible`

---

### Task 6: Tighten Friends proof-card identity, time, and Reply target

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`
- Create: `test/proof-card-density.test.mjs`
- Update: `test/mobile-social-proof-polish.test.mjs`, `test/social-mobile-polish.test.mjs`, or exact legacy source assertions intentionally replaced by the new card contract

**Interfaces:**
- `activityCard()` keeps habit emoji/title, display name, relative time, exact time.
- Friends proof card no longer consumes `actor.handle` or `activity.streak` for header copy.
- Profile/League username/streak rendering is untouched.

- [ ] **Step 1: Write RED card-density test**

Extract `activityCard` source and assert:

```js
assert.match(card, /proof-card-title/);
assert.match(card, /actor\?\.name/);
assert.match(card, /formatWhen\(activity\.when\)/);
assert.match(card, /formatExactTime\(activity\.when\)/);
assert.doesNotMatch(card, /actor\?\.handle|actorHandle/);
assert.doesNotMatch(card, /activity\.streak/);
```

CSS asserts `.proof-card-header` uses a small bottom margin, `.proof-card-byline` uses a tiny top margin, and `.comment-open` gets larger horizontal hit area/font without a taller min-height than the existing target.

- [ ] **Step 2: Run RED**

Run: `node --test test/proof-card-density.test.mjs`

Expected: FAIL on username/streak and spacing/Reply sizing.

- [ ] **Step 3: Simplify proof-card markup**

Render equivalent to:

```html
<div class="proof-card-title"><span>🏃</span><strong>2K Run</strong></div>
<div class="proof-card-byline">
  <button class="proof-card-author">Saksham</button>
  <span>· 2h ago</span>
  <span>· 9:13 PM</span>
</div>
```

Use actual display name for the current user's own card as well. Preserve invalid/rejected status only when relevant.

- [ ] **Step 4: Tighten CSS and enlarge Reply horizontally**

Use a small title/byline gap (roughly `.15rem-.25rem`), reduce header bottom spacing to `var(--space-1)`/equivalent, and make `.comment-open` use readable `var(--text-sm)`, horizontal padding, and a sensible minimum width while preserving the existing social-row height.

- [ ] **Step 5: Run Task 6 + social tests**

Run:

```bash
node --test test/proof-card-density.test.mjs test/mobile-social-proof-polish.test.mjs test/social-mobile-polish.test.mjs test/friends-ui.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Commit message: `polish: simplify Friends proof cards`

---

### Task 7: Apply DB migration, full verification, review, and release

**Files:**
- No new product files unless verification exposes a real defect.
- Review all changed files against `docs/superpowers/specs/2026-09-02-proof-friends-polish-design.md`.

**Interfaces:**
- Consumes every task above.
- Produces one reviewed feature-head SHA suitable for PR/merge.

- [ ] **Step 1: Run the full local/CI-equivalent gate on the exact feature tree**

Run:

```bash
npm test
npm run check
npm run build
```

Expected: zero failures and exit code 0 for all commands.

- [ ] **Step 2: Apply `20260902_cancel_friend_request.sql` to Supabase production**

Use the migration tool, not ad-hoc DDL execution.

- [ ] **Step 3: Verify live RPC definition and grants**

Query `pg_proc`/ACL and confirm:

- function is `SECURITY DEFINER` with empty `search_path`;
- authenticated has EXECUTE;
- anon/public do not;
- authorization predicate keys on `requester_id = auth.uid()` and pending state.

Run Supabase security advisors after DDL and distinguish pre-existing warnings from new regressions.

- [ ] **Step 4: Manual file-level review**

Review the branch diff for:

- no live-camera/getUserMedia remnants in active UX;
- no original + cropped double upload path;
- crop is conditional and main-only for Dual;
- second native camera cancellation preserves single review;
- cancel request cannot target another user's request;
- People mutations stay overlay-local;
- usernames/streaks remain present where still intended outside Friends proof cards;
- no temporary workflow/patch scripts remain.

- [ ] **Step 5: Trigger normal exact-head GitHub CI and Vercel preview**

Require GitHub CI success on the exact reviewed head. If Vercel reports Hobby build-rate limit, record deployment as blocked rather than retry-spamming builds.

- [ ] **Step 6: Open PR against `main` and merge only the reviewed exact head**

Use expected-head SHA protection for merge. Prefer squash merge to match recent Donezo workflow.

- [ ] **Step 7: Verify post-merge `main`**

Confirm the new main SHA, post-merge GitHub CI success, live Supabase migration state, and exact production Vercel SHA if the rate limit permits. If production is still rate-limited, explicitly report frontend deployment as the only incomplete release step.
