# Mobile Social Proof Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Donezo's mobile Friends/Proofs experience with relocated friend-growth actions, habit-first proof cards, inline reply previews, one positive reaction per user/proof, touch-native text behavior, and swipe-to-dismiss bottom sheets.

**Architecture:** Keep the existing vanilla JS rendering/state model and existing comments/reactions tables. Centralize new gesture behavior in `src/app.js`, keep styling in existing CSS files, enforce positive-reaction uniqueness with a Postgres partial unique index, and preserve the existing independent `👎` proof-rejection path.

**Tech Stack:** Vanilla ES modules, Node 24 test runner, CSS, Supabase/Postgres 17, GitHub Actions CI, service worker PWA shell.

**Spec:** `docs/superpowers/specs/2026-08-31-mobile-social-proof-polish-design.md`

## Global Constraints

- Do not move Invite/Add by link back into the parent Friends feed.
- Show at most two recent reply previews per proof card.
- Enforce one positive reaction (`👏`, `🔥`, `💪`, `😂`) per `(check_in_id, user_id)` while preserving independent `👎` rejection votes.
- Do not add a new comments/replies table or new reply subsystem.
- Disable text selection only for touch/coarse-pointer app content; preserve selection/caret behavior for text-entry controls.
- Standard bottom sheets dismiss by downward swipe without breaking sheet scrolling or form controls.
- Wrapped remains excluded from the standard bottom-sheet swipe gesture.
- Advance the service-worker cache version.

---

### Task 1: Add regression tests first

**Files:**
- Create: `test/mobile-social-proof-polish.test.mjs`

**Interfaces:**
- Consumes: existing `src/app.js`, `src/store.js`, `styles.css`, `social.css`, `sw.js`, and migration directory as source text.
- Produces: regression assertions that fail until Tasks 2-6 are implemented.

- [ ] **Step 1: Write failing tests**

Create a Node test file that asserts:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const social = await readFile(new URL('../social.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const migrationNames = await readdir(new URL('../supabase/migrations/', import.meta.url));
const migrationName = migrationNames.find((name) => name.includes('one_positive_reaction_per_proof'));
const migration = migrationName ? await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8') : '';
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

test('friend growth actions live in the Friends list sheet, not parent feed', () => {
  const friends = slice('function friendsScreen()', 'function challengeProgress');
  const people = slice('function peopleSheet()', 'function proofRejectSheet');
  assert.doesNotMatch(friends, /data-invite-open|data-add-friend-open/);
  assert.match(people, /data-invite-from-people/);
  assert.match(people, /data-add-friend-from-people/);
});

test('proof cards lead with habit identity and preview at most two replies', () => {
  const card = slice('function activityCard(', 'function personProofCarousel');
  assert.match(card, /proof-card-title/);
  assert.match(card, /proof-card-byline/);
  assert.match(card, /proofReplyPreview/);
  assert.match(app, /function proofReplyPreview\(/);
  assert.match(app, /\.slice\(-2\)/);
  assert.match(app, /View all .* replies/);
});

test('positive reaction toggles replace the previous positive reaction only', () => {
  assert.match(store, /positiveReactions/);
  assert.match(store, /emoji !== '👎'/);
  assert.match(store, /delete\(\).*neq\('emoji', '👎'\)|neq\('emoji', '👎'\).*delete\(\)/s);
  assert.match(migration, /row_number\(\).*partition by check_in_id, user_id/is);
  assert.match(migration, /where emoji <> '👎'/i);
  assert.match(migration, /create unique index.*check_in_id, user_id/is);
});

test('touch app content is non-selectable while text entry remains selectable', () => {
  assert.match(styles, /@media\s*\(pointer:\s*coarse\)/);
  assert.match(styles, /user-select:\s*none/);
  assert.match(styles, /input[^}]*user-select:\s*text|textarea[^}]*user-select:\s*text|contenteditable[^}]*user-select:\s*text/s);
});

test('standard bottom sheets initialize reusable swipe-down dismissal', () => {
  assert.match(app, /function bindSheetSwipeDismiss\(/);
  assert.match(app, /data-sheet/);
  assert.match(app, /closeSheets\(\)/);
  assert.match(social, /sheet\.is-dragging|\.sheet-backdrop\.is-dragging/);
});

test('PWA shell cache advances beyond v23', () => {
  assert.doesNotMatch(sw, /donezo-shell-v23/);
  assert.match(sw, /donezo-shell-v24/);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/mobile-social-proof-polish.test.mjs`

Expected: FAIL because the Friends parent still has both actions, proof-card markers/reply preview do not exist, positive-reaction uniqueness migration does not exist, swipe binding does not exist, touch selection CSS does not exist, and the service worker is still v23.

- [ ] **Step 3: Keep the failing test committed on the feature branch**

Commit message: `test: define mobile social proof polish`

---

### Task 2: Relocate Friends actions and restructure proof cards/reply previews

**Files:**
- Modify: `src/app.js`
- Modify: `social.css`

**Interfaces:**
- Consumes: `friendList`, `member`, `formatWhen`, `commentCheckInId`, existing `data-comment-open` and `data-friend-profile` handlers.
- Produces: `proofReplyPreview(checkInId)` HTML helper and new `proof-card-title`, `proof-card-byline`, `proof-reply-preview` markup/classes.

- [ ] **Step 1: Confirm Task 1 tests still fail for UI reasons**

Run: `node --test test/mobile-social-proof-polish.test.mjs`

Expected: FAIL.

- [ ] **Step 2: Move friend-growth actions**

Change `friendsScreen()` so it does not render `friends-action-row`, `data-invite-open`, or `data-add-friend-open`.

Change `peopleSheet()` so its footer renders:

```html
<div class="people-growth-actions">
  <button class="btn primary full" type="button" data-invite-from-people>… Invite friends</button>
  <button class="btn full" type="button" data-add-friend-from-people>Add by link</button>
</div>
```

Bind `data-add-friend-from-people` to close the People sheet state, clear the invite message, open `addFriendSheetOpen`, and render.

- [ ] **Step 3: Add compact reply preview helper**

Add `proofReplyPreview(checkInId)` that:

```js
const comments = (getState()?.comments || [])
  .filter((comment) => comment.checkInId === checkInId)
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
const visible = comments.slice(-2);
```

Render each visible reply with a tappable author and escaped body. When `comments.length > 2`, add a `data-comment-open` control labeled `View all ${comments.length} replies`.

- [ ] **Step 4: Use habit-first proof-card header**

For proof-backed completed activities, render the habit emoji/title first in `.proof-card-title`. Render actor name/handle, `formatWhen(activity.when)`, and `🔥 ${activity.streak}` in `.proof-card-byline` directly below. Keep profile navigation on the actor identity. Preserve the existing non-proof activity layout.

- [ ] **Step 5: Style the new hierarchy and reply preview**

Add focused CSS for `.proof-card-title`, `.proof-card-byline`, `.proof-reply-preview`, `.proof-reply-row`, `.proof-reply-author`, `.proof-reply-all`, and `.people-growth-actions` without changing unrelated components.

- [ ] **Step 6: Run targeted tests**

Run: `node --test test/mobile-social-proof-polish.test.mjs test/friends-ui.test.mjs test/social-features.test.mjs`

Expected: Friends/proof-card tests pass; reaction/swipe/touch/cache assertions may still fail until later tasks.

---

### Task 3: Enforce one positive reaction in repository logic

**Files:**
- Modify: `src/store.js`
- Modify: `test/social-features.test.mjs` if behavior-level memory-repository coverage is needed beyond source assertions.

**Interfaces:**
- Consumes: existing `toggleReaction(checkInId, emoji)` memory and Supabase repository methods.
- Produces: replace-or-remove semantics for one positive reaction, leaving `👎` untouched.

- [ ] **Step 1: Add/confirm a failing behavior test**

Add a memory-repository test that reacts `🔥`, then `👏`, and asserts only `👏` remains for the current user/check-in while a pre-existing `👎` remains independent.

- [ ] **Step 2: Run the behavior test and verify RED**

Run: `node --test test/social-features.test.mjs`

Expected: FAIL because the memory repository currently allows multiple positive emojis.

- [ ] **Step 3: Implement memory repository semantics**

In memory `toggleReaction`, collect current-user reactions for the check-in where `emoji !== '👎'`. Remove all positive rows first. If the tapped emoji was not the current sole selected emoji, add the new positive reaction. Do not remove `👎`.

- [ ] **Step 4: Implement Supabase repository semantics**

In Supabase `toggleReaction`:

```js
const positiveReactions = state.reactions.filter((reaction) =>
  reaction.checkInId === checkInId && reaction.userId === user.id && reaction.emoji !== '👎');
const selected = positiveReactions.length === 1 && positiveReactions[0].emoji === emoji;
const { error: deleteError } = await client.from('reactions')
  .delete()
  .eq('check_in_id', checkInId)
  .eq('user_id', user.id)
  .neq('emoji', '👎');
if (deleteError) throw appError(deleteError, 'Could not update reaction');
if (!selected) {
  const { error: insertError } = await client.from('reactions').insert({ check_in_id: checkInId, user_id: user.id, emoji });
  if (insertError) throw appError(insertError, 'Could not react');
}
return load();
```

- [ ] **Step 5: Run reaction tests**

Run: `node --test test/social-features.test.mjs test/mobile-social-proof-polish.test.mjs test/supabase-store.test.mjs`

Expected: reaction behavior passes; migration assertion remains red until Task 4.

---

### Task 4: Add database uniqueness migration

**Files:**
- Create: `supabase/migrations/<timestamp>_one_positive_reaction_per_proof.sql`

**Interfaces:**
- Consumes: `public.reactions(id, check_in_id, user_id, emoji, created_at)`.
- Produces: unique partial index `reactions_one_positive_per_user_checkin`.

- [ ] **Step 1: Create migration SQL**

Use:

```sql
-- Keep proof rejection (👎) independent, while allowing at most one positive reaction.
with ranked_positive_reactions as (
  select
    id,
    row_number() over (
      partition by check_in_id, user_id
      order by created_at desc, id desc
    ) as row_number
  from public.reactions
  where emoji <> '👎'
)
delete from public.reactions reaction
using ranked_positive_reactions ranked
where reaction.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists reactions_one_positive_per_user_checkin
  on public.reactions(check_in_id, user_id)
  where emoji <> '👎';
```

- [ ] **Step 2: Run migration-source regression test**

Run: `node --test test/mobile-social-proof-polish.test.mjs`

Expected: migration assertions pass.

- [ ] **Step 3: Do not apply production DDL yet**

Wait until application tests/check/build are green so the live database is not ahead of incompatible client code.

---

### Task 5: Add touch-native selection and swipe-down sheet dismissal

**Files:**
- Modify: `styles.css`
- Modify: `social.css`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `.sheet-backdrop`, `[data-sheet]`, `.sheet-handle`, `closeSheets()`, render/bind lifecycle.
- Produces: `bindSheetSwipeDismiss()`.

- [ ] **Step 1: Add touch-only selection CSS**

Add a coarse-pointer media query that sets `-webkit-user-select:none; user-select:none` for app content, while restoring `-webkit-user-select:text; user-select:text` on `input`, `textarea`, `[contenteditable="true"]`, and text-entry controls.

- [ ] **Step 2: Add reusable swipe binder**

Implement `bindSheetSwipeDismiss()` using pointer events. For each standard `[data-sheet]`:

- ignore Wrapped/full-screen sheets;
- start from `.sheet-handle`/`.sheet-head`, or from non-interactive sheet content only when `scrollTop <= 0`;
- track `startY`, last Y/time, and positive `deltaY`;
- apply a temporary translateY to the sheet and an opacity custom property/class to the backdrop;
- on pointerup/cancel, close when `deltaY >= 96` or downward velocity is at least about `0.55 px/ms` after a meaningful drag;
- otherwise clear transforms/classes and snap back;
- never prevent normal upward scrolling.

Call `bindSheetSwipeDismiss()` from the existing post-render event-binding lifecycle after sheet DOM exists.

- [ ] **Step 3: Style drag state**

Add `.sheet.is-dragging` / `.sheet-backdrop.is-dragging` rules so transitions are disabled during the drag and restored on release. Respect `prefers-reduced-motion`.

- [ ] **Step 4: Run targeted interaction-source tests**

Run: `node --test test/mobile-social-proof-polish.test.mjs test/mobile-social-v2.test.mjs test/polish-batch.test.mjs`

Expected: touch/swipe assertions pass.

---

### Task 6: Advance PWA cache and run full verification

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes: existing service-worker cache naming.
- Produces: `donezo-shell-v24`.

- [ ] **Step 1: Bump shell cache**

Change `const CACHE = 'donezo-shell-v23';` to `const CACHE = 'donezo-shell-v24';`.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: 0 failures.

- [ ] **Step 3: Run syntax checks**

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 4: Run production build**

Run with CI-safe env:

```bash
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_only \
npm run build
```

Expected: exit 0.

- [ ] **Step 5: Review diff against spec**

Confirm each design requirement maps to a concrete diff and no unrelated schema/UI work was added.

---

### Task 7: Apply and verify Supabase migration

**Files:**
- No additional source changes unless verification reveals an issue.

**Interfaces:**
- Consumes: migration SQL from Task 4 and live Donezo Supabase project.
- Produces: cleaned legacy duplicate positives and partial uniqueness enforcement.

- [ ] **Step 1: Apply the exact migration SQL to the live Donezo database**

Apply only after Tasks 1-6 are green.

- [ ] **Step 2: Verify data invariant**

Run:

```sql
select count(*) as duplicate_positive_pairs
from (
  select check_in_id, user_id
  from public.reactions
  where emoji <> '👎'
  group by check_in_id, user_id
  having count(*) > 1
) duplicates;
```

Expected: `0`.

- [ ] **Step 3: Verify index**

Query `pg_indexes` for `reactions_one_positive_per_user_checkin` and confirm its predicate is `emoji <> '👎'`.

- [ ] **Step 4: Run Supabase advisors**

Run security and performance advisors. Treat any new advisor attributable to this migration as a blocker; unrelated pre-existing notices may be reported separately.

---

### Task 8: Final branch verification and integration

**Files:**
- All changed files.

**Interfaces:**
- Consumes: completed feature branch and live DB migration.
- Produces: reviewable/mergeable Donezo change.

- [ ] **Step 1: Run fresh CI-equivalent verification**

Run `npm test`, `npm run check`, and the production build again on the final branch head.

- [ ] **Step 2: Open a PR against `main`**

Summarize UI changes, migration semantics, TDD coverage, and Supabase verification.

- [ ] **Step 3: Confirm GitHub Actions on the PR head**

Require the Donezo CI workflow to pass before merge.

- [ ] **Step 4: Merge after successful verification**

Use the repository's normal merge method. Vercel deployment is expected to follow the existing main-branch integration; inspect Vercel only if deployment status is unclear or fails.