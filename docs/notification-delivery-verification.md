# Notification Delivery Verification

This change completes Donezo's notification delivery pipeline and adds a Today check-in undo confirmation.

Verified on 2026-09-01:
- notification-worker wakeups require the project-specific Vault token;
- an unauthenticated worker wake returns HTTP 401;
- authenticated cron wakeups return HTTP 200;
- claim/generation/token-verification RPCs are executable by service_role only;
- the previously pending no-subscription event was settled as suppressed with `no_subscription`;
- the notification queue had no pending or processing rows after the live drain;
- `send-nudge` is queue-only and Web Push delivery is owned exclusively by notification-worker;
- pg_cron and pg_net are installed and the notification worker cron job is active.

This file intentionally contains no secret values, endpoints beyond public project identifiers, user identifiers, or notification contents.
