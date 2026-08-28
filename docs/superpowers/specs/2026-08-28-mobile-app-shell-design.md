# Donezo Mobile App Shell Design

## Goal
Make Donezo behave and read like an installed iPhone app: stable safe-area chrome, utility-first screens, logical daily navigation, and fair scoring that cannot be gamed by assigning arbitrary XP.

## App shell
- Lock viewport zoom for the installed/mobile experience with viewport scale constraints plus iOS gesture prevention.
- Use a `100dvh` app shell with three rows: safe-area-aware fixed header, one independently scrollable content pane, and safe-area-aware fixed bottom navigation.
- The header and bottom navigation never participate in page scrolling and never overlap the notch/status bar or home indicator.
- The stable top bar shows the Donezo brand at left and a clickable profile initial at right. Tapping the profile initial opens Me.

## Main navigation
Five persistent tabs: `Today`, `Squad`, `Check In`, `League`, `Me`.

`Check In` replaces `Add`. Creating habits is configuration and moves to Me through an `Add habit` control; the existing habit form opens as a mobile sheet rather than occupying a permanent primary tab.

## Today
- Compact page heading, not a hero block.
- Show greeting/date on one short line and immediately surface: remaining commitments, completion percentage, current streak, current weekly league rank, and next incomplete timed habit.
- List today's habits with incomplete habits before completed habits.
- Habit rows remain actionable so Today can still be used for quick check-ins.

## Check In
- Purpose-built daily action screen.
- Show today's completion progress, incomplete commitments first, and completed commitments beneath.
- Each incomplete habit clearly indicates `Check in` or `Add proof` according to its proof mode.
- Uses the same existing Supabase check-in/proof mutations as Today.

## Squad
- Compact page title with circle name and member count.
- Friend rows show useful accountability context rather than XP.
- Recent activity/proof feed begins near the top of the viewport; no large marketing headline.

## League and scoring
Remove user-assigned XP from all user-facing product logic.

The weekly league score is a completion percentage from 0–100. Every eligible daily commitment is one equal opportunity. For each habit, eligible days begin on the later of Monday of the current week or the habit's creation date, and end today. Score = completed eligible check-ins / eligible opportunities × 100.

This prevents users with more habits or self-selected high XP from automatically winning. Ties are broken by current streak, then name. The existing `habits.xp` database column remains unchanged for backward compatibility and is allowed to use its existing default, but the UI no longer exposes or depends on it.

## Me
- Compact account/profile header.
- Stats become weekly score, current streak, total check-ins, and circle members.
- Settings retain invite, notifications, install guidance, and sign out.
- Add a Habits settings section with the user's active habits and an `Add habit` control that opens the habit form as a mobile sheet.

## Visual system
Keep the approved warm paper / coral / lime / ink Hallmark system. Remove cobalt as the League hero treatment; the League score surface uses ink with coral/lime accents. Reduce oversized display typography and marketing-style copy across all signed-in screens.

## Data and backend
No Supabase schema migration is required. Add `createdAt` to mapped habit state using existing `habits.created_at`. Continue using current Auth, RLS, private proof storage, check-in and nudge paths unchanged.

## Verification
- Domain tests cover weekly scoring, habit creation-date eligibility, equal weighting, and league tie-breaking.
- Existing tests must remain green.
- Production build and syntax checks must pass.
- Vercel production must return the new viewport settings, token stylesheet, and Supabase client bundle after deployment.
