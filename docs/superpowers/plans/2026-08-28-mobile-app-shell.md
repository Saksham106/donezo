# Donezo Mobile App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Supabase-backed Donezo PWA into a utility-first iPhone-style app shell with fixed safe-area chrome, a Check In workflow, compact screens, and fair weekly completion scoring.

**Architecture:** Preserve the existing Supabase repository and RLS boundaries. Add pure scoring functions in `src/domain.js`, expose `habit.createdAt` from the existing database row mapping, and reorganize `src/app.js` so signed-in screens render inside one three-row app shell with a fixed top bar, scrollable center pane, and fixed navigation. CSS owns the safe-area and mobile-shell behavior; no database migration is required.

**Tech Stack:** Vanilla ES modules, CSS, Supabase JS 2.112.4, esbuild, Vercel static deployment, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-28-mobile-app-shell-design.md`

## Global Constraints
- Keep Supabase Auth, RLS, proof Storage, circle membership, check-in and nudge mutation paths unchanged.
- No Supabase schema migration.
- Keep the Hallmark warm paper / coral / lime / ink design system.
- Remove user-assigned XP from all user-facing UI and league logic; leave the existing database `xp` column intact.
- Signed-in app shell must use fixed safe-area-aware header/footer with only the middle pane scrolling.
- Main tabs are exactly `Today`, `Squad`, `Check In`, `League`, `Me`.

---

### Task 1: Fair weekly scoring

**Files:**
- Modify: `test/domain.test.mjs`
- Modify: `src/domain.js`

**Interfaces:**
- Produces: `weeklyCompletionScore(memberId, habits, checkIns, todayString) -> {completed, possible, percent}`
- Produces: `rankMembersByWeeklyScore(members, habits, checkIns, todayString) -> member[]` where each item contains `weeklyScore`, `weeklyCompleted`, `weeklyPossible`, and `rank`.

- [ ] **Step 1: Write failing domain tests**

Add tests proving equal weighting, current-Monday windowing, habit creation-date eligibility, and tie-breaking by `currentStreak` then name.

```js
assert.deepEqual(weeklyCompletionScore('a', habits, checkIns, '2026-08-27'), {
  completed: 5,
  possible: 8,
  percent: 63,
});
```

- [ ] **Step 2: Run `node --test test/domain.test.mjs` and verify RED**
Expected failure: missing scoring exports.

- [ ] **Step 3: Implement minimal pure scoring functions**
Use Monday as week start. For each active daily habit owned by the member, eligible dates begin at `max(weekStart, createdAtDate)` and end at `todayString`. Count each eligible day once and matching check-ins once. Return 0 when there are no eligible opportunities.

- [ ] **Step 4: Run domain tests and verify GREEN**
- [ ] **Step 5: Commit the scoring task**

### Task 2: Expose habit creation time

**Files:**
- Modify: `src/store.js`
- Modify: `test/supabase-store.test.mjs`

**Interfaces:**
- Produces mapped habit property `createdAt: string | null` from `habits.created_at`.

- [ ] **Step 1: Add a failing mapping assertion**
Assert `created_at: '2026-08-26T12:00:00Z'` maps to `createdAt` unchanged.
- [ ] **Step 2: Run the store test and verify RED**
- [ ] **Step 3: Add `createdAt: habit.created_at || null` to `mapDatabaseState`**
- [ ] **Step 4: Run the store test and verify GREEN**
- [ ] **Step 5: Commit the mapping task**

### Task 3: Rebuild signed-in navigation and utility screens

**Files:**
- Create: `test/app-shell.test.mjs`
- Modify: `src/app.js`

**Interfaces:**
- Consumes scoring functions from Task 1.
- Main tab values: `today | squad | checkin | league | me`.
- `[data-profile]` opens Me.
- `habitSheetOpen` opens habit configuration from Me.

- [ ] **Step 1: Add failing source-contract tests**
Assert navigation includes `Check In`, excludes the old Add tab, includes `data-profile`, and contains no user-facing XP select.
- [ ] **Step 2: Run the new test and verify RED**
- [ ] **Step 3: Recompose `src/app.js`**
Implement compact Today utility metrics; dedicated Check In; compact Squad; weekly-score League; Me stats and Habits settings; mobile habit sheet; no XP copy or XP selector.
- [ ] **Step 4: Run source-contract test and verify GREEN**
- [ ] **Step 5: Commit app structure changes**

### Task 4: iPhone-safe fixed shell

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `sw.js`
- Modify: `test/app-shell.test.mjs`

**Interfaces:**
- `.app-shell`: `height:100dvh`, three-row grid, overflow hidden.
- `.content-scroll`: sole signed-in vertical scroller.
- `.topbar` and `.nav`: safe-area aware non-scrolling rows.

- [ ] **Step 1: Add failing assertions for viewport and safe-area shell**
Assert `maximum-scale=1`, `user-scalable=no`, `100dvh`, `safe-area-inset-top`, `safe-area-inset-bottom`, and `.content-scroll` with vertical scrolling.
- [ ] **Step 2: Run test and verify RED**
- [ ] **Step 3: Implement viewport and shell CSS**
- [ ] **Step 4: Add non-passive iOS `gesturestart` / `gesturechange` prevention in `src/app.js`**
- [ ] **Step 5: Bump service-worker cache version**
- [ ] **Step 6: Run source-contract tests and verify GREEN**
- [ ] **Step 7: Commit shell changes**

### Task 5: Regression verification and release

- [ ] **Step 1: Run `npm test`**
- [ ] **Step 2: Run `npm run check`**
- [ ] **Step 3: Run production `npm run build` using existing public Supabase env**
- [ ] **Step 4: Review diff and confirm no migration/RLS changes or secret material**
- [ ] **Step 5: Open PR, verify mergeability, and merge to `main`**
- [ ] **Step 6: Deploy merged `main` to existing Donezo Vercel production project**
- [ ] **Step 7: Verify production root/assets return 200, zoom-lock viewport is present, Vercel is `READY`, and the deployed bundle still includes the Supabase client**
