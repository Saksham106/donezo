-- Persist the amount confirmed by each check-in so quantity targets affect scoring.

alter table public.check_ins
  add column if not exists completed_quantity numeric not null default 1
  check (completed_quantity > 0 and completed_quantity <= 1000000);

comment on column public.check_ins.completed_quantity is
  'Amount completed for the habit occurrence. Donezo check-ins confirm the full planned target in one tap.';
