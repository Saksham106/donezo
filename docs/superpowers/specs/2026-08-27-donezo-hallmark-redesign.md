# Donezo Hallmark Redesign

## Goal
Rework the existing mobile-first Donezo PWA so it feels like a deliberate consumer social product rather than a generic dark dashboard, while preserving all existing product behavior and routes.

## Product direction
Audience: small friend groups using Donezo primarily on phones to hold each other accountable.
Use case: open the app, understand today's commitments immediately, check in, and feel social pressure/reward from the squad.
Tone: playful-social with sporty competitive energy. Social-first like BeReal/Partiful; performance cues like Strava/Nike Run Club.

## Visual system
Use a custom light palette built around warm paper and near-black ink. Coral is the primary brand/action color. Acid-lime is reserved for earned completion/success. Cobalt is reserved for social/competitive context. Avoid gradient-heavy surfaces and avoid making every section a rounded card.

Typography: Bricolage Grotesque for display, DM Sans for body/UI, DM Mono for metrics and compact labels. Headings stay roman. Use a 4px spacing scale and tokenized OKLCH color values only.

## Screen composition
- Today: editorial greeting + compact streak/progress scoreboard; habits become flatter actionable rows with strong completion affordances.
- Squad: social feed is the one area where card/post surfaces are appropriate; overdue activity gets stronger callout treatment and a clear nudge action.
- Add: large, calm form with fewer nested containers and clearer field hierarchy.
- League: leaderboard reads like a competitive scoreboard, not a settings table; top ranks and current user get distinct but restrained treatment.
- Me: profile metrics sit in an integrated grid; settings become quiet utility rows.
- Navigation: fixed native-feeling bottom dock with a prominent add action but less floating-pill styling.

## Interaction rules
Keep motion restrained: transform/opacity only, short durations, no bounce. Provide hover, focus-visible, active, disabled, loading, error, and success styling patterns for interactive controls. Respect prefers-reduced-motion. Keep every tap target comfortable for phone use.

## Responsive requirements
No horizontal scrolling. Support 320, 375, 414, and 768px widths. Keep primary clickable labels single-line. Long headings must wrap safely. The app remains mobile-first with a centered desktop shell.

## Implementation boundaries
Preserve all existing flows, IDs, local repository behavior, PWA/service-worker behavior, and data semantics. No file deletions. Main implementation files: `tokens.css`, `styles.css`, `index.html`, `manifest.webmanifest`, and small class/markup adjustments in `src/app.js`. Add `.hallmark/log.json` for project design memory.