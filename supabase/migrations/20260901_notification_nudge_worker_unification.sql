-- Route nudges through the same atomic notification worker as every other
-- category. This removes the duplicate-delivery race between the legacy direct
-- sender and a concurrent cron queue drain.

drop trigger if exists wake_notification_worker on public.notification_events;
create trigger wake_notification_worker
  after insert on public.notification_events
  for each row
  when (
    new.status = 'pending'
    and new.category in ('friend_activity', 'reaction', 'comment', 'challenge_progress', 'nudge')
  )
  execute function private.wake_notification_worker();
