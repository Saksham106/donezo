-- Clients may supply completed_at through the Data API. Always replace it with
-- the database clock so feed ordering and audit timestamps cannot be forged.
create or replace function private.set_check_in_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.completed_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists set_check_in_completed_at on public.check_ins;
create trigger set_check_in_completed_at
before insert on public.check_ins
for each row execute function private.set_check_in_completed_at();
