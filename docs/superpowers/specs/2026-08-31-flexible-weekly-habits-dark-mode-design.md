# Flexible Weekly Habits + Warm Graphite Dark Mode Design

## Goal

Make habit scheduling fit real routines such as “gym any 4 days per week,” fix the travel/break editor so it feels native on mobile, and redesign dark mode so it feels like the nighttime version of Donezo’s warm light theme rather than a blue/navy variant.

## Scope

This batch includes:
- a new flexible `X days per week` habit schedule;
- Monday–Sunday goal windows;
- a first-full-week rule for newly created flexible weekly habits;
- correct weekly progress/accountability/League semantics;
- preserved historical schedule versions;
- a mobile-native pause disclosure and overflow-safe From/Through fields;
- a Warm Graphite dark palette with accessible contrast.

This batch does not add monthly goals, rolling 7-day windows, reminder redesigns, or a general recurrence builder.

## Flexible weekly schedule

### User model

The habit editor Schedule control offers:
- Every day
- Specific days
- X times per week
- Once a week

Selecting `X times per week` hides weekday chips and shows a weekly target picker/stepper from 1 through 7, phrased as `N days per week`.

Example: `Gym · 4 days per week`.

### Data model

Add a dedicated `weekly_target_days` integer to both `habits` and `habit_schedule_versions` rather than overloading `target_quantity`.

`target_quantity` remains the amount needed for a single check-in/occurrence, such as 20 pages or 30 minutes. `weekly_target_days` means the number of distinct local calendar days in a Monday–Sunday window on which the habit must be completed.

Add a new schedule frequency value `times_per_week`.

Constraints:
- `weekly_target_days` is 1–7 when frequency is `times_per_week`;
- other schedule types ignore the field;
- existing habits and existing schedule versions preserve current behavior.

All owner checks, immutable schedule history, and RLS boundaries remain unchanged. Schedule changes continue through the existing owner-checked RPC/versioning path.

### First-week behavior

A newly created `times_per_week` habit does not create an accountability target in the partial week in which it was created. Its first official goal window starts on the next Monday in the habit schedule timezone.

Check-ins made before that Monday are allowed and remain visible as activity/history, but do not add possible/completed commitments for that partial week and do not affect League/adherence.

For later edits from another schedule type into `times_per_week`, the new schedule version becomes effective using the existing versioning rules. If the effective date is not Monday, the flexible weekly target begins on the next Monday so no partial weekly obligation is introduced.

### Weekly progress semantics

A `times_per_week` goal is evaluated across one Monday–Sunday window.

- Each distinct local calendar date with a valid completed check-in counts at most once toward the weekly target.
- Multiple check-ins on the same date do not create multiple weekly-day credits.
- Progress is `completed distinct days / weekly_target_days`.
- The goal is complete once the completed-day count reaches the target.
- There is no concept of a daily miss on an arbitrary unchosen weekday.
- A paused date cannot count as an expected day and a check-in on a paused date does not create target credit.

Today/Check In UI should show progress such as `2 of 4 this week` and allow check-in on any active day until the target is reached. Once complete, the habit is shown as complete for the current week rather than due again every remaining day.

### Accountability and League

For a full active week, a `4 days per week` habit contributes 4 possible commitments, not seven daily commitments and not one weekly commitment.

Completed commitments equal the number of credited distinct completion days up to the target. Missing commitments are determined only when the week is evaluated as a whole; Tuesday is never individually marked missed simply because the user did not choose Tuesday.

Weekly League scoring must preserve the existing anti-gaming/maturity logic while treating each credited day as one completion slot. The weekly percentage denominator uses the configured target count.

Pause windows reduce the obligation fairly. For this batch, if a pause overlaps a flexible goal week, required target days are capped by the number of non-paused eligible days in that week. Example: a 4-day target with five paused days has only two eligible days, so the effective target for that week is 2. A fully paused week has zero possible commitments.

## Habit editor UX

The flexible schedule should read as a simple mobile choice, not a recurrence form.

For `times_per_week`:
- hide the weekday selector;
- show a compact `Days per week` control with 1–7 values;
- keep Amount/Unit, Due time, Grace, Proof, and audience fields working as today;
- helper copy explains that any distinct days count within Monday–Sunday.

For all other schedules, preserve current controls and behavior.

## Pause / travel-break UX

Replace native `<details><summary>` disclosure with an app-style button row/card:
- label: `Pause for travel or a break`;
- custom chevron icon aligned at the trailing edge;
- chevron rotates with the expanded state;
- minimum 44px tap target;
- proper `aria-expanded` and controlled content region.

The expanded form stays inline.

The From/Through date inputs use an overflow-safe grid:
- two equal columns on normal phones;
- `min-width: 0` on grid children and inputs;
- width constrained to the parent;
- stack to one column only on very narrow screens.

No browser-default disclosure marker should remain visible.

## Dark mode: Warm Graphite

Light mode is unchanged.

Dark mode moves neutral surfaces away from hue 258 blue/navy and into warm, near-neutral graphite values that visually relate to the cream light palette.

Surface hierarchy:
- canvas: darkest warm graphite;
- app background: slightly lighter;
- standard cards/controls: another small lightness step;
- raised sheets/elevated cards: slightly brighter again;
- borders use warm neutral gray rather than blue-gray.

Text:
- primary text is soft warm off-white, not pure white;
- secondary/tertiary text maintain clear hierarchy;
- normal text contrast must meet WCAG AA 4.5:1 against its intended surface.

Accents:
- coral remains the primary Donezo accent, slightly tuned for dark surfaces;
- lime remains completion/success;
- cobalt/blue is removed from general neutral surfaces and retained only where blue is semantically meaningful;
- saturated status colors use darker tinted surfaces and restrained chroma so they do not glow against the dark background.

Elevation should come primarily from tonal surface separation rather than heavy shadows.

Explicit dark mode and system-driven dark mode must resolve to the same token values to prevent visual drift.

## Testing

Add tests for:
- schedule normalization/validation for `times_per_week`;
- Monday–Sunday weekly window and distinct-day counting;
- no partial first-week obligation;
- same-day duplicate check-ins counting once;
- target completion and no extra post-target obligation;
- pause-window target capping;
- weekly completion and League denominator/progress;
- DB migration constraints and RPC persistence/versioning;
- editor visibility/copy for the new schedule;
- custom pause disclosure semantics and overflow-safe CSS;
- dark-mode token parity between explicit and system dark mode;
- contrast checks for primary/secondary text and key controls.

Run the complete existing suite, syntax/check scripts, build, and production artifact verification before merge/deploy.
