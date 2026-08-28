# Donezo Social Proof + Push UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Donezo UX cleanup, proof invalidation, editable nudges/display name, correct timezone-aware League scoring, and real Web Push plumbing.

**Architecture:** Keep the current vanilla ES module frontend and Supabase repository. Add pure domain helpers for proof rejection + timezone-safe scoring, load reactions/timezones in `src/store.js`, add one migration to harden reaction policies, and add a pinned Supabase Edge Function for VAPID/public-key + nudge push delivery. Reorganize Me/Squad via mobile sheets without changing the five primary tabs.

**Tech Stack:** Vanilla JS/CSS, Supabase JS 2.112.4, Postgres/RLS, Supabase Edge Functions (Deno + pinned npm dependency), Web Push, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-28-social-proof-push-ux-design.md`

## Global Constraints
- Preserve existing Auth, circle membership, Storage proof privacy, and check-in ownership boundaries.
- Never expose a VAPID private key or service role secret to the browser or GitHub repo.
- Invalid proofs must be excluded from Today, streaks, and League consistently.
- Push failures must not roll back an already-saved in-app nudge.
- No horizontal scrolling anywhere in signed-in app or sheets.

---

### Task 1: Domain correctness
- Add failing tests for strict-majority downvote threshold, rejected check-in filtering, and owner-timezone habit creation dates.
- Implement pure helpers in `src/domain.js`.
- Re-run domain tests.

### Task 2: Supabase state + mutations
- Add failing mapping tests for member timezone, self activity, reactions, invalidation metadata.
- Load profile timezone for every member, load reactions for visible check-ins, include current user's activity.
- Add repository methods: update display name, set/remove downvote, mark nudge read, replace invalid proof, register push subscription.
- Make habit proof default `photo` and stop sending explicit XP.

### Task 3: Backend migration + push function
- Add migration tightening reaction RLS: same-circle only, no self-downvote for `👎`.
- Add authenticated `send-nudge` Edge Function with pinned dependencies.
- Function supports `vapid-public-key` and `send-nudge` actions, derives/stores no browser secret, validates sender, and prunes 404/410 subscriptions.
- Because the Supabase action connector is currently unavailable, commit these backend artifacts and apply/deploy when the connector is available; do not pretend they ran.

### Task 4: Notifications client + service worker
- Add Web Push subscription helper using PushManager and VAPID public key returned by Edge Function.
- Persist subscription through `push_subscriptions`.
- Add service worker `push` event and notification click behavior.

### Task 5: UX restructure
- Fix iPhone bottom gap using fixed app root and safe-area-contained nav.
- Add topbar nudge inbox badge/button.
- Move Invite friends to Squad.
- Add editable nudge composer.
- Add Settings sheet with display-name editor, notifications, install info, sign out.
- Keep Me focused on stats + habits.
- Show self + squad activity and downvote controls.
- Add invalid-proof redo flow and playful contextual Today copy.
- Fix habit sheet width overflow and default proof copy (`Photo / screenshot`, `Truuust me`).

### Task 6: Verify + release
- Run source/domain/store tests and syntax checks.
- Review diff for secret material and unrelated Supabase/security changes.
- Open PR and merge when clean.
- Deploy production Vercel build and verify root/CSS/JS/service worker.
- If Supabase connector is still unavailable, report backend apply/deploy as the only blocked step with exact artifacts ready.
