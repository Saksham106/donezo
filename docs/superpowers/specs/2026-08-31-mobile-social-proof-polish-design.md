# Mobile Social Proof Polish Design

## Goal

Make Donezo feel more like a native mobile social app by simplifying Friends actions, improving proof-card hierarchy and reply visibility, enforcing one positive reaction per person per proof, disabling accidental text selection on touch devices, and allowing bottom sheets to dismiss with a downward swipe.

## Friends actions

The parent Friends feed keeps only its heading, refresh control, People/Friends-list control, Proofs/Activity tabs, and feed. The `Invite` and `Add by link` actions must not render at the top level.

The Friends list sheet (`peopleSheet`) owns both relationship-growth actions. They render together after the friend/request list at the bottom of the sheet: a primary `Invite friends` action and a secondary `Add by link` action. Existing invite and add-by-link flows remain unchanged.

## Proof-card hierarchy

Proof cards use the habit as the primary subject. For proof-backed completed activities:

1. The habit emoji and habit title appear first as the largest/strongest text in the card.
2. Directly below is a visually secondary byline containing the actor identity, relative post time, and streak in one compact row: `Name/@handle · 2d ago · 🔥 7`.
3. The proof image follows.
4. Proof-review controls, reactions, and replies remain below the image.

The actor name remains tappable and opens the existing friend profile. Non-proof Activity cards can retain their existing layout.

## Reply previews

The existing `check_in_comments` model and reply sheet remain the source of truth. No new reply schema is introduced.

Each proof card renders at most the two most recent replies inline. The selected two are displayed in chronological order so the newest reply is last. Each preview row shows the author name/handle and reply body. The author remains tappable to open the existing profile.

If a proof has more than two replies, render `View all N replies`; tapping it opens the existing reply sheet. The existing `Reply` entry point also remains available.

## Reaction semantics

Positive reactions are `👏`, `🔥`, `💪`, and `😂`. The proof-rejection vote `👎` is a separate moderation signal and is not part of the one-positive-reaction rule.

For each `(check_in_id, user_id)` pair:

- zero or one positive reaction may exist;
- tapping the currently selected positive emoji removes it;
- tapping a different positive emoji replaces the previous positive reaction;
- a user may still independently have a `👎` rejection vote where the existing product flow permits it.

The frontend must render at most one active positive emoji for the current user. The repository must delete any existing positive reaction(s) before inserting a different positive emoji.

The database must enforce the invariant with a partial unique index on `(check_in_id, user_id)` where `emoji <> '👎'`. Before creating the index, the migration removes legacy duplicate positive reactions, keeping the newest by `created_at` and then `id`. The existing three-column uniqueness remains in place.

## Touch text selection

On coarse-pointer/touch devices, regular application chrome/content is non-selectable so long-press does not produce browser-style blue text highlighting. Inputs, textareas, contenteditable elements, and other text-entry controls retain normal selection/caret behavior.

Desktop accessibility and keyboard focus behavior remain unchanged.

## Swipe-to-dismiss bottom sheets

All standard `.sheet` bottom sheets share one drag-down dismissal behavior. The gesture is attached centrally after render instead of reimplemented per sheet.

Behavior:

- dragging down from the handle/header area always engages the sheet gesture;
- dragging down elsewhere engages only when the sheet scroll position is at the top;
- upward motion and normal scrolling are not hijacked;
- interactive form controls are not used as drag-start targets unless the gesture starts on the dedicated handle;
- while dragging, the sheet follows the finger and backdrop opacity softens;
- release past a distance threshold or with sufficient downward velocity closes the sheet through the existing `closeSheets()` state reset;
- release below threshold animates the sheet back to rest;
- reduced-motion users do not receive unnecessary animation.

The full-screen Wrapped surface is excluded because it is not a standard bottom sheet.

## PWA cache

Because `src/app.js`, `styles.css`, and `social.css` change, advance the service-worker shell cache version so installed PWAs receive the new interaction code/styles cleanly.

## Testing and verification

Regression tests must cover:

- parent Friends feed no longer contains Invite/Add by link;
- Friends list sheet contains both actions;
- proof cards use habit-first hierarchy and inline reply preview markers;
- reaction repository logic guarantees one positive reaction while preserving `👎` independence;
- migration contains legacy cleanup plus a partial unique positive-reaction index;
- touch-only non-selection CSS preserves selection in form fields;
- reusable sheet swipe gesture is initialized for standard sheets and calls the existing close path;
- service-worker cache version advances.

Run `npm test`, `npm run check`, and `npm run build`. After applying the database migration, query Postgres to verify no duplicate positive `(check_in_id, user_id)` pairs remain and the partial unique index exists. Run Supabase security/performance advisors after the DDL change.