# Dual-camera proofs, full-image feed, and unified Updates design

Date: 2026-09-02
Status: design for user review before implementation planning

## Goals

This change combines three product decisions into one coherent social-proof experience:

1. Add a BeReal-style `dual_photo` proof mode configured per habit.
2. Show the complete proof image directly in the Friends feed and profile proof history, with no crop-to-thumbnail + separate “open proof” viewer flow.
3. Remove the separate Proofs / Activity feed tabs. Friends becomes a proof-first feed, while the existing top-right nudge inbox becomes a unified Updates center containing nudges plus the non-proof activity that currently lives in the Activity tab.

The design must preserve current proof reactions, replies, rejection voting, audience privacy, undo/re-upload behavior, scoring, and existing single-photo proofs.

## Product decisions

### Habit proof modes

Habits support exactly three proof modes:

- `none`
- `photo`
- `dual_photo`

`dual_photo` is configured on the habit rather than chosen ad hoc at check-in time. This keeps accountability expectations stable and visible before the user checks in.

A regular `photo` habit keeps today’s camera / library / paste options. A `dual_photo` habit launches the dual-camera flow and does not present library or paste as first-class alternatives.

Because Donezo is a web/PWA app, camera-only behavior cannot be treated as tamper-proof. The UI will request live front/rear capture, but some browser/OS fallback camera pickers may still expose the photo library. The feature is social accountability, not cryptographic attestation.

### Dual-camera output

Donezo stores one final composite proof file, not two independent proof objects.

The rear/main capture remains the full background image. The front/selfie capture is rendered as a square inset in the top-right, BeReal-style. The composite preserves the main capture’s aspect ratio rather than forcing a crop. It is encoded as JPEG and passed through the existing proof upload pipeline and 4 MB limit.

This deliberately avoids adding `front_proof_path` / `rear_proof_path` to `check_ins`. Existing reactions, rejection votes, signed URLs, storage RLS, cleanup, proof history, undo, and re-upload all continue to operate against one `proof_path`.

### Friends screen

Friends no longer has Proofs and Activity tabs. The main Friends feed is the proof feed.

The existing non-proof Activity tab content moves into the top-right inbox, which is renamed from a nudge-only inbox to **Updates**. People/invite controls and other Friends-page actions remain where they are unless directly affected by removal of the tab selector.

### Updates center

Updates mixes:

- incoming nudges;
- the exact non-proof activity stream that currently appears in the Activity tab.

Items are sorted newest first. Nudge rows remain visually distinct. Non-proof activity is rendered as compact rows rather than full proof-sized cards, but it must preserve the same actor, event meaning, timestamp, and profile navigation the Activity tab exposes today.

The top-right badge represents all unseen Updates, not only unread nudges.

Opening Updates uses one server cutoff timestamp. The server marks every incoming nudge created at or before that cutoff as read and advances the user’s non-proof activity high-water mark to the same cutoff. Updates arriving after that cutoff remain unseen. The UI clears the badge optimistically and reconciles to the server result.

No new push-notification categories are introduced by this feature. Existing nudge and social notification delivery behavior remains unchanged.

## Architecture

### 1. Dual-photo capture module

Create `src/dual-proof.js`, responsible for:

- dual-capture state transitions;
- camera capability checks;
- front/rear stream acquisition;
- frame capture;
- composition geometry;
- producing the final uploadable `File`.

`src/app.js` coordinates sheets and user actions but does not contain the low-level camera/composition logic.

The existing `src/proof.js` remains responsible for generic proof validation/compression. Shared image decode/encode helpers may be factored so both single-photo compression and dual composition use the same safe image primitives.

### 2. Capture flow

For a `dual_photo` habit:

1. Open an in-app camera sheet.
2. Request rear/environment camera via `navigator.mediaDevices.getUserMedia`.
3. User captures the main proof.
4. Stop that stream before requesting the front/user-facing camera.
5. User captures the selfie.
6. Show a review screen with the composed result.
7. Allow **Retake proof**, **Retake selfie**, **Submit proof**, and **Cancel**.
8. Submit the composite through the existing `completeWithProof(habitId, date, file)` path.

Camera tracks must be stopped whenever capture is completed, cancelled, the sheet closes, or an error occurs.

### 3. Camera fallback

If in-app camera access is unavailable, denied, or cannot switch cameras, fall back to sequential capture-oriented file inputs:

- environment-facing proof input;
- user-facing selfie input.

The fallback still feeds the same composition/review pipeline. If the browser exposes only a generic chooser, the app explains the limitation rather than pretending the image is guaranteed live.

A dual-photo habit must never silently downgrade to a proof-less/simple check-in.

### 4. Composition

The final canvas uses the main capture’s aspect ratio. The main image is scaled down only when its long edge exceeds 2048 px; it is never cropped.

The selfie inset is exactly 30% of the composite width, square, positioned 3% from the top and right edges, with rounded corners and a small contrasting border/shadow. The selfie uses a centered square crop inside its inset; the main proof remains uncropped.

The output is encoded as JPEG, then validated/compressed to the existing maximum proof size before upload.

Composition errors retain the already captured source images in local state so the user can retry instead of restarting the whole check-in.

## Data model and Supabase

### Proof mode

Add `dual_photo` to the `habits.proof_mode` constraint.

All current server-side validation/policies that distinguish `none` from `photo` must be updated so both `photo` and `dual_photo` are proof-bearing. Use the business rule:

- `proof_mode = 'none'` -> `proof_path` must be null;
- `proof_mode <> 'none'` -> a valid proof object/path is required.

No new proof-path columns are added to `check_ins`.

The frontend/store must likewise stop using checks such as `proofMode === 'photo'` when the real business rule is “this habit requires proof.” Add one shared helper named `requiresPhotoProof(proofMode)` so `photo` and `dual_photo` cannot accidentally fall through to simple check-in behavior.

### Updates read state

Add:

`public.user_update_state(user_id uuid primary key references public.profiles(id) on delete cascade, last_seen_at timestamptz not null)`

RLS allows only the authenticated user to select/insert/update their own row.

Existing users are backfilled with `last_seen_at = now()` at migration time so deployment does not create a badge containing months of historical activity. New users receive `last_seen_at = now()` when their update-state row is first created.

Add a server-authoritative RPC named `public.mark_updates_seen()` that:

1. captures server `now()` once as `seen_through`;
2. marks the caller’s unread incoming nudges with `created_at <= seen_through` as read at `seen_through`;
3. upserts `user_update_state.last_seen_at = seen_through`;
4. returns `seen_through`.

The repository loads `last_seen_at` with the user’s social state. Unseen non-proof activity is any currently authorized activity item whose event timestamp is later than `last_seen_at`.

The badge count is the number of normalized unseen update items: each unread nudge counts once and each unseen non-proof activity item counts once. Nudges and non-proof activity are separate update kinds, so they are not double-counted.

Opening Updates optimistically clears the badge, then persists via `mark_updates_seen()`. If persistence fails, authoritative refresh restores the correct unread state and a non-blocking error is shown.

This read state does not change visibility. Activity continues to be filtered by the same existing friend/audience rules as the current Activity tab.

## Full-image proof feed

### Rendering

Proof cards keep lazy signed-URL loading, but the image is rendered directly in the card at its natural aspect ratio:

- no fixed thumbnail crop;
- no `object-fit: cover` crop;
- no “Open proof” action;
- no click-to-open proof viewer requirement.

The inline proof image uses the full available card width and natural height (`width: 100%; height: auto`). The image itself is never cropped. Very tall images are allowed to make a tall post rather than hiding content behind a viewer.

Dual-photo composites naturally render like any other proof because they are a single image object.

### Viewer removal

Remove the standalone proof-viewer UI/state and its event handlers wherever it exists solely to reveal the uncropped image. Signed-URL caching/lazy loading that still benefits the inline feed remains, renamed if needed so it no longer models “thumbnail vs viewer.”

Profile Proof history follows the same rule: show the complete proof image inline in the history carousel/list without requiring a second viewer.

Reactions, replies, rejection status, and “Run it back” remain attached to the proof card exactly as today.

## Friends / Updates information architecture

### Friends

Friends becomes:

- existing heading/actions;
- proof feed only;
- existing bounded incremental loading behavior;
- existing empty state adapted to proofs only.

Remove:

- `squadFeed` state;
- `donezo.squadFeed` persistence;
- Proofs / Activity segmented controls;
- conditional feed filtering based on the selected tab.

### Updates

Rename the nudge inbox presentation to **Updates** while reusing the existing top-right entry point and badge location.

Normalize every row to this shape before rendering:

- `kind`: `nudge` or `activity`;
- `id`;
- `when`;
- actor identity;
- compact message/detail;
- optional profile/action target;
- `unseenAtOpen`.

The sheet shows 20 normalized items initially, newest first, with a compact **More** control for additional loaded items. The badge count still considers the full currently loaded authorized update set rather than only the first 20 rendered rows.

Nudges keep their existing action semantics. Activity rows do not introduce reactions/comments there; social interaction remains centered on proof cards.

The former Activity tab is removed only after regression coverage proves Updates contains every activity type that tab previously rendered.

## Error handling

### Camera

- Permission denied: offer the sequential native-camera fallback.
- No camera APIs: go directly to fallback.
- Camera switch failure: retain the completed main shot and request the selfie through fallback capture.
- Stream/capture error: stop all tracks and preserve any valid capture already made.
- Composition failure: preserve both source captures and allow retry.

### Upload

The existing proof review/upload retry semantics remain: if upload fails, keep the final composite locally and let the user retry.

### Inline proof image

If a signed URL or image load fails, show an inline proof error/retry state inside the card. Do not reintroduce a separate viewer as the recovery path.

### Updates state

If `mark_updates_seen()` fails, the Updates sheet still opens. Reconciliation restores unread state, and the user receives a concise retryable error rather than losing update data.

## Privacy and security

- Dual-photo files use the existing proof bucket/path authorization model.
- The composite has exactly the same audience as the check-in.
- No camera frame is uploaded before the user submits the reviewed composite.
- Camera streams are local only and must be stopped after use.
- No extra friend/activity visibility is introduced by moving Activity into Updates.
- Update read state is private to the current user.

## Compatibility and migration safety

The schema migration is backward-compatible with existing `none` and `photo` habits/check-ins.

Server-side check-in validation must reject proof-less completion for `dual_photo`, protecting users who may still have an older cached frontend that does not understand the new mode.

Old proof rows remain unchanged and render inline using their existing single `proof_path`.

## Testing

### Unit/domain

- `dual_photo` is recognized as proof-required everywhere `photo` currently is.
- dual-capture state transitions preserve captures across retakes/errors.
- camera stream cleanup always stops tracks.
- composition preserves main-image aspect ratio and exact selfie geometry.
- composite output obeys supported MIME/size rules.
- fallback capture feeds the same review/composition path.
- update unseen-count logic uses `last_seen_at` and unread nudges correctly.

### Repository/database

- migration accepts `dual_photo` and rejects invalid proof modes;
- proof-required RLS/check-in constraints cover both photo modes;
- existing update-state rows are backfilled without historical unread inflation;
- `mark_updates_seen()` can affect only the authenticated user and their incoming nudges at/before its server cutoff;
- activity visibility remains unchanged;
- dual-photo upload still creates exactly one storage object and one `proof_path`;
- undo/rejected-proof replacement cleans up the composite exactly once.

### UI/regression

- habit editor shows None / Photo / Dual photo;
- dual-photo habit launches the dual capture flow;
- regular photo habit keeps camera/library/paste behavior;
- proof feed contains no crop/open-proof requirement;
- proof cards and profile history show whole images inline;
- standalone proof viewer is removed;
- Friends has no Proofs / Activity tabs and always renders proofs;
- Updates contains nudges plus every former non-proof Activity type;
- Updates renders 20 items initially and can reveal more;
- badge represents all unseen Updates;
- reactions, replies, rejection counts, exact timestamps, and profile navigation remain intact.

### Manual mobile verification

Before merge, verify on at least iPhone Safari/PWA and a Chromium mobile browser where available:

- camera permission first-run and previously denied paths;
- rear -> front switching;
- sequential fallback;
- retake one side without losing the other;
- cancellation stops camera indicators/tracks;
- portrait and landscape main captures;
- full-image feed rendering without crop;
- dark mode;
- Updates badge/read behavior across refresh.

## Rollout

Implement in one feature branch but in dependency order:

1. database support for `dual_photo` and Updates read state;
2. proof-mode/domain/store compatibility;
3. dual-capture/composition module and UI;
4. full-image proof rendering and viewer removal;
5. Friends tab removal and unified Updates center;
6. regression/manual verification;
7. deploy migration and frontend with server-side proof enforcement in place before users can create dual-photo habits.

No existing production proof data is rewritten.