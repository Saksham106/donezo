# Donezo Hallmark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cohesive playful-social visual redesign for the existing Donezo PWA without changing application behavior.

**Architecture:** Keep the current vanilla HTML/CSS/JS architecture. Introduce a standalone token layer, refactor the existing stylesheet to consume tokens, and make only small semantic class/markup changes in `src/app.js` so all existing event wiring and local data behavior remain intact.

**Tech Stack:** Vanilla HTML, CSS, JavaScript, PWA manifest/service worker, Google Fonts.

**Spec:** `docs/superpowers/specs/2026-08-27-donezo-hallmark-redesign.md`

## Global Constraints
- Preserve existing behavior and routes.
- No file deletions.
- All colors and font families must come from named tokens.
- Mobile-first; no horizontal scroll at 320/375/414/768px.
- Motion uses transform/opacity only and respects reduced motion.
- Coral = brand/action; lime = completion/success; cobalt = social/competitive context.

---

### Task 1: Establish the design-token layer

**Files:**
- Create: `tokens.css`
- Modify: `index.html`
- Modify: `manifest.webmanifest`

**Interfaces:**
- Produces CSS variables consumed by `styles.css`: `--color-*`, `--font-*`, `--space-*`, `--text-*`, `--ease-*`, `--dur-*`, `--rule-*`, `--radius-*`.

- [ ] Create the OKLCH palette, font roles, spacing scale, radii, timing and typography tokens.
- [ ] Import `tokens.css` from the page stylesheet path.
- [ ] Change browser/PWA theme metadata from dark charcoal to warm paper.
- [ ] Verify every declared color/font used by the redesign is represented by a token.

### Task 2: Recompose the five screens without changing behavior

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes existing `repo`, `done`, `dailyProgress`, `calculateStreak`, `rankMembers`, notification helpers.
- Produces the same `data-tab`, `data-habit`, `data-nudge`, form IDs and notification IDs used by current event wiring.

- [ ] Refine top bar and greeting markup into clearer semantic groups.
- [ ] Recompose Today progress and habit rows with dedicated status/meta classes.
- [ ] Recompose Squad activity posts and overdue/nudge treatment.
- [ ] Recompose Add form fields and proof/XP controls without changing names/values.
- [ ] Recompose League and Me markup for stronger visual hierarchy.
- [ ] Preserve every selector used by the current event handlers.

### Task 3: Replace the visual layer

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes only variables from `tokens.css` for colors and fonts.

- [ ] Add the Hallmark stamp at the first non-empty line.
- [ ] Build the warm-paper base, typography hierarchy, shell and top bar.
- [ ] Build Today scoreboard and flatter habit rows.
- [ ] Build social-feed post surfaces and overdue treatment.
- [ ] Build Add form, League scoreboard, profile stats and utility settings.
- [ ] Build native-feeling bottom navigation.
- [ ] Add hover/focus/active/disabled/loading/error/success state styling patterns.
- [ ] Add 320/375/414/768 responsive rules and reduced-motion handling.

### Task 4: Record Hallmark project memory and verify

**Files:**
- Create: `.hallmark/log.json`

**Interfaces:**
- Records macrostructure/theme/enrichment for future redesign diversification.

- [ ] Record the redesign as a custom playful-social app-shell system.
- [ ] Check the branch diff for accidental behavioral changes.
- [ ] Verify key selectors still exist: `data-tab`, `data-habit`, `data-nudge`, `habit-form`, `notification-btn`, `proof-input`.
- [ ] Deploy the branch as a Vercel preview and verify the page, CSS, JS, manifest and service worker return successfully.
- [ ] Run a Hallmark self-critique; revise any axis below 3/5 before handoff.