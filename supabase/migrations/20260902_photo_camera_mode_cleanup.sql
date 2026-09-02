-- Dual photo is a capture choice inside Photo proof, not a habit-level proof mode.
-- There are no production dual_photo habits, so fail closed if that assumption changes.

alter table public.habits
  drop constraint if exists habits_proof_mode_check;

alter table public.habits
  add constraint habits_proof_mode_check
  check (proof_mode in ('none', 'photo'));
