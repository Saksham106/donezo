# Donezo — Accountability PWA MVP

A mobile-first social accountability prototype for small friend groups. Track daily habits, submit optional photo proof, nudge friends, protect streaks, and compete on a weekly XP leaderboard.

## What works

- Today checklist with XP and streak progress
- Optional photo/screenshot proof
- Friend activity feed with nudges
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
4. Launch Donezo from the Home Screen.
5. Open **Me** → **Enable** notifications.

Remote scheduled pushes are intentionally not included yet. The MVP proves the browser/PWA notification plumbing; a backend can later store push subscriptions and send scheduled pushes.

## Architecture

The executable MVP is a zero-dependency static PWA. State mutation is isolated in `src/store.js`, domain calculations are pure functions in `src/domain.js`, and the UI is in `src/app.js`.

The intended production migration remains:

- Next.js + TypeScript
- Tailwind/shadcn UI
- Supabase Auth + Postgres + Storage
- Web Push subscription storage/server delivery
- Vercel deployment

Supabase Realtime is **not required for push notifications**. Add it later only if live cross-device feed/leaderboard updates are worthwhile.
