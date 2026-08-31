# Flexible Weekly Habits + Warm Graphite Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fair Monday–Sunday `X days per week` habits, fix the pause editor’s mobile disclosure/layout, and ship a warmer accessible dark theme without changing light mode.

**Architecture:** Extend the existing schedule/version model with `times_per_week` plus `weekly_target_days`, and evaluate flexible goals at the weekly ledger layer rather than pretending they create fixed daily occurrences. Keep per-check-in quantity semantics unchanged. UI/store/database all carry the new field explicitly; dark mode remains token-driven.

**Tech Stack:** Vanilla ES modules, Node test runner, CSS/OKLCH tokens, Supabase/Postgres/RPC/RLS, Vercel/PWA.

**Spec:** `docs/superpowers/specs/2026-08-31-flexible-weekly-habits-dark-mode-design.md`

## Global Constraints

- Week window is Monday–Sunday.
- `weekly_target_days` is 1–7 and only meaningful for `times_per_week`.
- A flexible weekly goal created or made effective midweek begins scoring next Monday.
- Distinct local dates count at most once; same-day duplicate check-ins never earn extra weekly credit.
- Pause windows cap the effective weekly target by eligible non-paused days; a fully paused week contributes zero possible commitments.
- Existing daily, specific-day, once-weekly, historical-version, RLS, and owner-only write behavior must remain intact.
- Light mode is unchanged.
- Dark mode explicit selection and system selection use the same Warm Graphite token set.

---

### Task 1: Flexible schedule primitives

**Files:**
- Modify: `test/schedule.test.mjs`
- Modify: `src/schedule.js`

**Interfaces:**
- `normalizeSchedule(input)` accepts `frequency: 'times_per_week'` and returns `weeklyTargetDays`.
- Export `weekStartForDate(localDate)` and `effectiveWeeklyTarget(input, weekStart)` for use by domain scoring.
- `getScheduleOccurrence()` must not invent fixed weekday obligations for `times_per_week`.

- [ ] Add failing schedule tests that assert `times_per_week` normalizes a 1–7 target, rejects 0/8, resolves Monday week starts, starts scoring on the next Monday when effective midweek, and caps a 4-day target to 2 when only two non-paused days are eligible.
- [ ] Run `node --test test/schedule.test.mjs` and confirm failures are because the new frequency/helpers do not exist.
- [ ] Implement the minimal schedule normalization/week helpers.
- [ ] Re-run `node --test test/schedule.test.mjs` and confirm green.
- [ ] Commit schedule primitives.

### Task 2: Weekly accountability + League semantics

**Files:**
- Modify: `test/domain.test.mjs`
- Modify: `src/domain.js`

**Interfaces:**
- Weekly ledger consumes `habit.scheduleFrequency`, `habit.weeklyTargetDays`, schedule versions, pause windows, and valid check-ins.
- For `times_per_week`, ledger contributes `effectiveTarget` possible slots and `min(distinctCompletedDays, effectiveTarget)` completed slots.

- [ ] Add failing tests for 4×/week progress, same-day duplicate de-duplication, no partial first-week obligation, no post-target extra obligation, pause capping, and historical schedule-version transition.
- [ ] Run `node --test test/domain.test.mjs` and confirm RED for the missing flexible semantics.
- [ ] Refactor `weeklyCommitmentLedger` minimally so fixed-date schedules keep the existing path while `times_per_week` uses weekly slots.
- [ ] Keep League maturity/anti-gaming behavior by treating each credited distinct day as a completion slot and never awarding more slots than the effective target.
- [ ] Re-run `node --test test/domain.test.mjs` and confirm all domain tests pass.
- [ ] Commit weekly scoring behavior.

### Task 3: Database + repository persistence

**Files:**
- Create: `supabase/migrations/20260831_flexible_weekly_habits.sql`
- Modify: `test/schedule-migration.test.mjs`
- Modify: `src/store.js`

**Interfaces:**
- DB columns: `public.habits.weekly_target_days integer`, `public.habit_schedule_versions.weekly_target_days integer`.
- RPC `public.create_habit_schedule_version(..., p_weekly_target_days integer default 1)` persists the field to both current habit and immutable version row.
- Store maps DB `weekly_target_days` to JS `weeklyTargetDays` and passes it to the RPC.

- [ ] Add failing structural migration/store tests for the new columns, 1–7 constraints, accepted frequency, owner-check preservation, explicit EXECUTE grant, mapping, and RPC argument.
- [ ] Run the focused migration/store tests and confirm RED.
- [ ] Write migration SQL by extending constraints and replacing the owner-checked schedule RPC with the new parameter while preserving `SECURITY DEFINER`, `set search_path = ''`, explicit `auth.uid()` ownership check, revoke-from-public/anon, and grant-to-authenticated behavior.
- [ ] Map/persist `weeklyTargetDays` in `src/store.js` and include it wherever a schedule object is constructed.
- [ ] Re-run focused tests and full syntax checks.
- [ ] Commit DB/repository support.

### Task 4: Habit sheet + weekly progress UX

**Files:**
- Modify: `test/habit-ui.test.mjs`
- Modify: `src/app.js`
- Modify: `components.css` and/or `social.css`

**Interfaces:**
- Schedule option value: `times_per_week`.
- Form field: `weeklyTargetDays`, integer 1–7.
- Flexible helper copy: any distinct days count Monday–Sunday.

- [ ] Add failing UI tests for the new option, 1–7 control, conditional weekday visibility, form serialization, edit-mode hydration, and `N of M this week` copy.
- [ ] Run `node --test test/habit-ui.test.mjs` and confirm RED.
- [ ] Add the schedule choice and conditional field visibility without rerendering away unsaved form fields.
- [ ] Pass `weeklyTargetDays` through create/edit handlers.
- [ ] Make flexible habits appear available for check-in on eligible days until the weekly target is complete; after completion, show complete-for-week status rather than a daily miss/due state.
- [ ] Re-run habit UI tests and relevant app tests.
- [ ] Commit flexible habit UI.

### Task 5: Native-feeling pause editor

**Files:**
- Modify: `test/habit-ui.test.mjs`
- Modify: `src/app.js`
- Modify: `components.css` and/or `social.css`

**Interfaces:**
- Button uses `data-toggle-habit-pause`, `aria-expanded`, and a custom inline SVG chevron.
- Controlled panel uses `data-habit-pause-panel`.

- [ ] Add failing assertions that native `<details><summary>` is gone from the habit pause UI, a custom chevron/disclosure button is present, and date-grid CSS is overflow-safe.
- [ ] Run focused test and confirm RED.
- [ ] Replace native disclosure with app-state-driven expansion that preserves form drafts and uses a 44px tap target.
- [ ] Add `min-width:0`, constrained date inputs, and a narrow-screen single-column fallback.
- [ ] Re-run habit UI tests.
- [ ] Commit pause UX fixes.

### Task 6: Warm Graphite dark mode

**Files:**
- Modify: `test/visual-system.test.mjs`
- Modify: `tokens.css`

**Interfaces:**
- One shared dark-token declaration source must feed both `[data-theme="dark"]` and system dark mode to prevent drift.
- Neutral dark surfaces use warm/near-neutral hues rather than hue 258 blue/navy.

- [ ] Add failing tests that reject blue-tinted dark neutrals, assert explicit/system parity, and calculate WCAG contrast >=4.5:1 for primary/secondary text against their intended dark surfaces.
- [ ] Run `node --test test/visual-system.test.mjs` and confirm RED.
- [ ] Replace dark neutrals with Warm Graphite hierarchy, tune coral/lime/status surfaces for dark backgrounds, and deduplicate explicit/system token declarations.
- [ ] Re-run visual tests and full suite.
- [ ] Commit dark-mode redesign.

### Task 7: PWA, database verification, CI, PR, production

**Files:**
- Modify: `sw.js`
- Update/add any version assertion tests that intentionally pin the shell version.

- [ ] Bump PWA cache from v25 to v26 with a failing version assertion first if existing tests pin the cache.
- [ ] Run `npm test`, `npm run check`, and `npm run build`.
- [ ] Review branch diff for accidental files, security regression, and light-mode changes.
- [ ] Apply the reviewed migration to the connected Supabase project only after code/tests are green.
- [ ] Verify live columns/constraints/function signature and run a safe schema query; do not fabricate test user data.
- [ ] Open PR, wait for green CI, merge only after checks pass.
- [ ] Verify the production Vercel deployment is READY and the public `/sw.js` serves v26.
