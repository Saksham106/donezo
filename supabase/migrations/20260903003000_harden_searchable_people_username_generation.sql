-- Serialize automatic username generation for accounts that normalize to the
-- same readable base. The unique constraint remains the final correctness
-- boundary, while this transaction-scoped lock prevents a concurrent signup
-- from failing just because another transaction chose the same base first.

create or replace function private.generated_donezo_username(target_display_name text, target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text := replace(target_user_id::text, '-', '');
  suffix_length integer := 6;
begin
  base := coalesce(private.normalize_donezo_username(target_display_name), 'user');
  if base !~ '^[a-z0-9]' then
    base := 'user_' || base;
  end if;
  base := left(base, 30);
  if length(base) < 3 then
    base := rpad(base, 3, '0');
  end if;

  -- Same-base generators wait for one another until the current transaction
  -- commits, so the next caller sees the username inserted by the first.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(base, 0));

  candidate := base;
  while candidate in ('admin', 'administrator', 'donezo', 'support', 'system')
    or exists (
      select 1
      from public.profiles existing_profile
      where existing_profile.username = candidate
        and existing_profile.id <> target_user_id
    )
  loop
    candidate := left(base, greatest(1, 30 - suffix_length - 1)) || '_' || left(suffix, suffix_length);
    suffix_length := least(20, suffix_length + 2);
  end loop;

  return candidate;
end;
$$;
