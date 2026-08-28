# Donezo Social Proof + Push UX Design

## Goal
Make Donezo feel like a complete social accountability app: compact phone-native UI, editable identity/nudges, real push notifications, self-visible activity, proof downvoting with invalidation, and correct weekly scoring across timezones.

## App information architecture
- **Today:** compact daily status, playful contextual copy, today metrics, next commitment, today list.
- **Squad:** people + daily progress, invite flow, full recent activity including the current user, proof viewing/downvoting, nudge composer.
- **Check In:** only the daily action flow.
- **League:** weekly completion percentage, invalid proofs excluded.
- **Me:** personal stats + compact habit management only.
- **Top-right controls:** profile/settings button plus a nudge inbox button with unread count.
- **Settings sheet:** edit display name, notifications, install info, sign out.
- **Nudge inbox sheet:** incoming nudges, compact and dismissible/mark-read.

## Proof voting
- Use existing `reactions` table with emoji `👎` for proof rejection.
- A user cannot downvote their own check-in.
- Only members sharing the same circle can vote/read votes.
- A proof is invalid when downvotes are a **strict majority of all other circle members**: threshold `floor((circle_size - 1) / 2) + 1`.
- Invalid check-ins do not count toward Today completion, streaks, or League.
- Invalid proof cards show playful copy such as `Proof got cooked 💀 — run it back`.
- Re-uploading proof replaces that day's check-in; old reactions cascade away.

## Scoring/timezone correctness
- Preserve equal-weight weekly completion scoring.
- Habit eligibility starts on the habit owner's local calendar date, not UTC `created_at.slice(0,10)`.
- Load timezone for every member profile and derive each habit's creation date in its owner's timezone.
- Invalidated check-ins are filtered before streak and weekly score calculations.

## Push notifications
- Persist standard Web Push subscriptions in existing `push_subscriptions` table.
- Browser subscribes using a VAPID public key after notification permission is granted.
- Sending a nudge calls an authenticated server-side push sender after the nudge row is inserted.
- Push sender validates sender identity/circle membership, loads the recipient's subscriptions, and sends the nudge payload to every active endpoint.
- Expired subscriptions are removed when push providers return 404/410.
- Never expose the VAPID private key to the browser or repository.

## Habit creation
- Default proof mode: `photo`.
- Options: `Photo / screenshot` and `Truuust me`.
- No XP selector or user-facing XP.
- Bottom sheet must never horizontally scroll; all controls use `min-width:0`, `max-width:100%`, and iOS-safe time input sizing.

## Phone shell
- `#app` and signed-in app shell use fixed viewport bounds (`position:fixed; inset:0`) to eliminate the bottom dead area shown on iPhone.
- Header, content scroller, and bottom nav remain three distinct rows.
- Safe-area padding stays inside the header/nav rather than adding page height.

## Tone
Use playful copy sparingly in high-salience status moments, e.g. `Lock in bro 😭`, `One more. Don't sell.`, `Clean sweep. Go rot responsibly.` Standard controls remain clear and literal.

## Security
- Keep RLS enabled on all exposed tables.
- Harden reaction policies to same-circle visibility and no self-downvotes.
- Push subscriptions remain owner-only.
- Push sender must authenticate the requesting user and must not accept arbitrary recipient IDs outside the sender's current circle.
