-- Authenticate cron/trigger wakeups without embedding a reusable secret in source.
-- The token is generated once per project, stored in Vault, and compared only
-- by a service-role-only verifier called from the Edge worker.

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'donezo_notification_worker_token'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'donezo_notification_worker_token',
      'Authenticates Donezo notification worker wakeups from pg_cron/pg_net'
    );
  end if;
end;
$$;

create or replace function public.verify_notification_worker_token(supplied_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select supplied_token is not null
    and exists (
      select 1
      from vault.decrypted_secrets secret
      where secret.name = 'donezo_notification_worker_token'
        and secret.decrypted_secret = supplied_token
    );
$$;
revoke all on function public.verify_notification_worker_token(text) from public, anon, authenticated;
grant execute on function public.verify_notification_worker_token(text) to service_role;

create or replace function private.wake_notification_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_token text;
begin
  select decrypted_secret into worker_token
  from vault.decrypted_secrets
  where name = 'donezo_notification_worker_token';

  if worker_token is null then
    raise warning 'Donezo notification worker token is missing';
    return new;
  end if;

  perform net.http_post(
    url := 'https://kiqntckwcqxkxgpuajyi.supabase.co/functions/v1/notification-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-donezo-worker-token', worker_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke all on function private.wake_notification_worker() from public, anon, authenticated;

-- Replace the anonymous wake job with a Vault-authenticated request.
do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'donezo-notification-worker' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'donezo-notification-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://kiqntckwcqxkxgpuajyi.supabase.co/functions/v1/notification-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-donezo-worker-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'donezo_notification_worker_token'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $cron$
);
