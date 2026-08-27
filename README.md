# Lock In — Accountability PWA MVP

A mobile-first social accountability prototype for small friend groups. Track daily habits, submit optional photo proof, nudge friends, protect streaks, and compete on a weekly XP leaderboard.

## What works

- Today checklist with XP and streak progress
- Optional photo/screenshot proof
- Friend activity feed with reactions and nudges
- Create recurring habits
- Weekly leaderboard
- Local persistence via `localStorage`
- Installable PWA manifest + service worker/offline shell
- Notification permission flow + local test notification
- Responsive phone-first UI

## Run locally

No package installation is required. The tests and local server use Node's built-in APIs.

```bash
npm test
npm run check
npm start
```

Then open `http://localhost:4173`.

## iPhone PWA test

1. Serve the project over HTTPS (or deploy it).
2. Open it in Safari.
3. Share → **Add to Home Screen**.
4. Launch it from the Home Screen.
5. Open **Me** → **Enable** notifications.

Remote scheduled pushes are intentionally not included yet. The MVP only proves the browser/PWA notification plumbing. A backend will later store push subscriptions and send scheduled pushes.

## Architecture

The current executable prototype is deliberately zero-dependency because the build environment used to create it could not reach the npm registry. State mutation is isolated in `src/store.js`, and domain calculations are pure functions in `src/domain.js`.

The intended production migration remains:

- Next.js + TypeScript
- Tailwind/shadcn UI
- Supabase Auth + Postgres + Storage
- Web Push subscription storage/server delivery
- Vercel deployment

Supabase Realtime is **not required for push notifications**. Add it only if live cross-device feed/leaderboard updates become worthwhile.

## Files

- `index.html` — shell
- `styles.css` — responsive visual system
- `src/app.js` — screens and browser interactions
- `src/store.js` — persistence/repository boundary
- `src/domain.js` — progress, streak, leaderboard logic
- `src/demo-data.js` — seeded social demo data
- `src/notifications.js` — notification/service worker browser API wrapper
- `sw.js` — service worker
- `manifest.webmanifest` — PWA manifest
- `test/*.test.mjs` — domain/store/notification tests
