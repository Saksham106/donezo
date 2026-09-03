# Proof Capture, Friend Controls, and Feed Density Design

## Scope

This change tightens four existing Donezo flows without adding new primary navigation:

1. simplify photo proof capture around the native iPhone picker/camera;
2. add conditional manual cropping for unusually tall proof images before upload;
3. make friend-request cancellation and unfriending available directly from People;
4. reduce information density and wasted space in Friends proof cards.

The current searchable People architecture, immutable proof-audience model, reaction/reply systems, and proof storage bucket remain intact.

## 1. Native-only proof capture

### Source sheet

The proof source sheet exposes only:

- **Take photo** — invokes the native environment-facing camera input;
- **Choose from library** — invokes the normal `image/*` file input so iOS may offer Photo Library / Take Photo / Choose File;
- **Paste copied photo**.

Remove the visible **Use Donezo camera** option and remove the in-app `getUserMedia()` camera UX. Native file/camera capture is the supported proof-capture path. Existing dual-proof composition helpers may remain where they are still useful, but dead live-camera state, sheets, bindings, and CSS should be deleted rather than hidden.

### Single-photo review

After photo #1 is selected, the review screen has one compact two-button row:

- **Choose another** — opens the normal iOS file chooser. This replaces the redundant Retake button because iOS already includes Take Photo in that chooser.
- **Make Dual** — a visually emphasized secondary-accent action, not a neutral utility button.

The normal Submit proof action remains below the review state.

## 2. Dual proof in either order

Tapping **Make Dual** opens a tiny role-choice sheet asking:

> What was this photo?

Choices:

- **Main proof**
- **Selfie**

If photo #1 is Main proof, Donezo opens the native user-facing camera for photo #2. If photo #1 is Selfie, Donezo opens the native environment-facing camera for photo #2.

Cancelling photo #2 must preserve photo #1 and return to a valid single-photo review. No permission-heavy live camera is involved.

Once both images exist, Donezo knows which file is the main proof and which is the selfie regardless of capture order. The existing visual treatment remains: the main proof is the base image and the selfie is a square inset. The dual review may expose compact **Replace main** and **Replace selfie** controls, using the native inputs for replacement.

The final dual upload remains exactly one JPEG.

## 3. Conditional manual crop before upload

### Crop rule

Donezo allows portrait proofs up to a **3:4 width:height ratio** without cropping. In other words, an image needs cropping only when its oriented height is greater than `width * 4 / 3`.

Normal landscape, square, 4:5-ish, and standard 3:4 phone photos skip this step entirely.

### Crop interaction

Cropping is a pre-upload operation, not a feed-only CSS crop.

When the final main proof is too tall:

1. Donezo opens a 3:4 crop sheet before upload.
2. The crop viewport is fixed at 3:4.
3. Because only too-tall images enter this flow, the image fills the crop width and the user drags vertically to choose which portion is retained.
4. The crop offset is clamped so the viewport never exposes empty space.
5. **Use crop** renders the selected region client-side to JPEG.
6. **Cancel** returns to proof review with the original local file still available and nothing uploaded.

The crop sheet should support touch/pointer dragging and have a deterministic pure crop-math helper that is unit tested separately from DOM interaction.

### Storage behavior

Only the final proof artifact is uploaded:

- single proof: cropped JPEG when crop was required, otherwise the selected/compressed proof file;
- dual proof: crop the main image first when required, then compose main + selfie into one JPEG, then upload that one composite.

The uncropped source files remain only in browser memory during review/cropping and are never uploaded as extra storage objects. Existing 4 MB proof validation/compression rules still apply to the final artifact.

This change applies to new uploads. Existing stored proofs are not destructively recropped because Donezo cannot infer the user's desired crop for historical images.

## 4. Relationship button as the management control

People/search rows use one relationship button that changes with state:

- **Add** → send friend request;
- **Requested** → tapping again cancels the current user's outgoing pending request;
- **Accept** → accept an incoming request;
- **Friends** → tapping opens a small confirmation sheet with **Remove friend**.

There is no separate friend-management page.

### Cancel request backend

Add a server-authoritative RPC for cancelling an outgoing request. It must:

- require authentication;
- accept a pending request identifier;
- succeed only when `requester_id = auth.uid()` and `status = 'pending'`;
- transition the request to `cancelled` and set `responded_at`;
- reject attempts to cancel another user's request or a terminal request;
- expose execution only to `authenticated`.

The repository exposes the RPC through `cancelFriendRequest(requestId)` in both production and memory adapters.

### UI behavior

Outgoing cancellation is optimistic: **Requested** immediately returns to **Add**, rolls back if persistence fails, and does not rebuild the Friends feed underneath the People overlay.

Friend removal reuses the existing `remove_friend` RPC, but becomes directly accessible from the **Friends** relationship button. Removal requires the small confirmation sheet because it changes sharing relationships. After success, the People overlay refreshes from current repository state without navigating through a profile.

## 5. Friends proof-card density

### Header content

Proof cards show only:

**Habit emoji + habit title**

then immediately underneath:

**Display name · relative time · exact clock time**

Example:

`🏃 2K Run`

`Saksham · 2h ago · 9:13 PM`

Remove from the Friends feed card:

- `@username`;
- streak count.

Do not remove usernames from People/search/profile, and do not remove streak information from profile/League surfaces.

The byline uses the person's display name, including the current user's own card, rather than adding a second username/handle identity. Existing rejected/invalid proof status may still appear when relevant.

### Spacing

The byline visually belongs to the title: use only a very small gap between title and byline. Reduce the proof-card header bottom margin so media starts closer to this two-line header.

### Reply target

The Reply control becomes easier to hit without increasing card height:

- retain the existing social-row height;
- increase Reply's horizontal padding/minimum width and use `var(--text-sm)` or equivalent readable sizing;
- use currently empty space on the right side of the reaction row rather than adding another vertical row.

Reaction scrolling remains horizontal-only.

## 6. Error and cancellation behavior

- Cancelling native capture leaves the previous review state intact when possible.
- Cancelling the Dual second photo restores valid single-photo review.
- Cancelling crop uploads nothing and restores review.
- Crop/decode failures show a concise retryable error while retaining the local proof file.
- Failed request cancellation restores **Requested**.
- Failed unfriend leaves **Friends** unchanged and keeps the confirmation/People context usable.
- Existing proof upload retry behavior continues to retain the final local artifact after upload failure.

## 7. Files and boundaries

Expected implementation boundaries:

- `src/app.js` — proof/People sheet state and bindings, compact proof-card markup;
- `src/proof.js` — reusable image decoding/encoding interfaces if needed;
- `src/proof-crop.js` — new pure crop math + client-side crop rendering;
- `src/dual-proof.js` — dual composition/state changes needed for capture-order independence;
- `src/store.js` — cancel-request repository methods and memory behavior;
- `social.css` — compact review controls, crop sheet, relationship controls, proof-card spacing/Reply sizing;
- `index.html` — native file inputs only; remove inputs only if genuinely unused after live-camera deletion;
- new Supabase migration — authenticated `cancel_friend_request` RPC;
- focused regression tests plus updates to legacy tests whose expectations are intentionally replaced.

Do not introduce a third-party crop library. Canvas/Image decoding already exists in Donezo's proof pipeline and is sufficient for this bounded crop editor.

## 8. Verification

Use TDD for each independently rejectable behavior:

1. native-only source/review flow and dead live-camera removal;
2. Main-first and Selfie-first Dual conversion, including second-camera cancellation;
3. 3:4 crop threshold, clamped crop math, JPEG output, single and Dual upload ordering;
4. outgoing request cancellation authorization + repository behavior + optimistic UI;
5. direct Friends-button removal confirmation;
6. proof-card identity/time density and larger Reply target without taller social row.

Before merge:

- focused tests pass;
- full `npm test` passes;
- `npm run check` passes;
- `npm run build` passes;
- Supabase migration is applied and the RPC definition/grants are verified;
- PR diff gets a manual file-level review;
- exact-head GitHub CI is green;
- Vercel preview/production is verified when Vercel's Hobby build-rate limit permits deployment. A Vercel rate-limit failure must be reported as deployment incomplete rather than treated as a product-code failure.
