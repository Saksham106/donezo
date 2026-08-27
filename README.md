# Donezo — Accountability with friends

A mobile-first social accountability PWA for small friend groups. Create habits, submit optional photo proof, nudge friends, protect streaks, and compete on a shared XP scoreboard.

## Stack

- Static mobile-first PWA bundled with esbuild
- Supabase Auth, Postgres, Row Level Security, and private Storage
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

## Current product flow

1. Sign up or sign in with email/password.
2. Create a circle or join one with its 12-character invite code.
3. Add daily habits and choose whether photo proof is required.
4. Check in, upload private proof, nudge friends, and view the shared feed/scoreboard.

All application tables have RLS enabled. Proof files are private and are exposed to circle peers only through short-lived signed URLs.

## iPhone PWA test

1. Open the deployed HTTPS URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch Donezo from the Home Screen.
4. Open **Me** → **Enable** notifications.

Remote scheduled push delivery is not implemented yet. The current notification control proves the installed-PWA browser permission and local notification path.
