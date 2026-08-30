# Donezo — Accountability with friends

A mobile-first social accountability PWA for small friend groups. Set realistic habits, post proof, recover after misses, and keep each other moving without turning life into a complicated game.

## Stack

- Static mobile-first PWA bundled with esbuild
- Supabase Auth, Postgres, Row Level Security, private Storage, and Edge Functions
- Vercel hosting
- Node's built-in test runner

## Local setup

```bash
npm install
cp .env.example .env.local
# Export the two values from .env.local, then:
npm test
npm run check
npm run build
npm start
```

Required build variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Open `http://localhost:4173` after building.

## Product flow

1. Create or join a squad and invite at least one friend.
2. Add an editable starter habit or a custom daily, weekday, or weekly habit.
3. Check in quickly with optional photo proof and react to friends in the Squad feed.
4. Use weekly challenges, opt-in social stakes, missed-habit recovery, and privacy-safe recaps.
5. Tune notification categories, quiet hours, timezone, and per-habit reminders in Settings.

All application tables use RLS. Proof files are private and exposed to squad peers only through short-lived signed URLs. Contextual notification events are deduplicated and filtered against user preferences server-side before delivery.

## iPhone PWA test

1. Open the deployed HTTPS URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch Donezo from the Home Screen.
4. Open **Settings** → **Enable** notifications.
5. Test camera proof, keyboard-safe sheets, deep links, and safe-area behavior on a real device before release.
